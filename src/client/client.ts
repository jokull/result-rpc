import type { AnyPublicTaggedError, AnyTaggedError } from "../error.js";
import {
  ClientDecodeFailure,
  ServerBadRequest,
  ClientHttpFailure,
  ClientNetworkFailure,
  ClientOffline,
  ClientProtocolViolation,
  ClientStale,
  ClientTimeout,
  frameworkErrorDefinitions,
  STALE_RECLASSIFIABLE_TAGS,
  ServerInternal,
  type ClientBoundaryError,
} from "../framework-errors.js";
import { contractDigest } from "../contract-digest.js";
import { getOnlineSnapshot } from "../connectivity.js";
import {
  decodeStreamFrame,
  decodeResponseEnvelope,
  isProtocolContentType,
  isStreamContentType,
  type ResponseEnvelope,
} from "../protocol.js";
import { err, ok, type Result } from "../result.js";
import { DEFAULT_MAX_WIRE_BYTES, deserialize } from "../serializer.js";
import { encodeProcedureInput } from "../wire.js";
import type {
  ContractRouterRecord,
  ErrorDefinitionMap,
  Router,
  RouterContract,
  RouterRecord,
} from "../server/contract.js";
import {
  createClientErrorRegistry,
  type BaseClientOf,
  type ClientErrorOf,
  type ClientErrorRegistry,
  type ClientErrors,
  type ClientProcedure,
  type ClientRecord,
  type ClientRouter,
  type ProcedureClient,
  type ResultSubscription,
} from "./base-client.js";
import {
  getClientIdentity,
  getClientRouter,
  getProcedureClientMetadata,
  recordTouchedEntities,
  registerClientIdentity,
  registerProcedureClient,
  type ProcedureClientMetadata,
} from "./client-metadata.js";
import {
  cancelled,
  isCancelled,
  requestEnvelope,
  type ClientTransport,
  type TransportRequestOptions,
  type TransportResponse,
} from "./transport.js";

export type BrowserBoundaryError =
  | ReturnType<typeof ServerInternal>
  | ReturnType<typeof ServerBadRequest>
  | ClientBoundaryError;

export type BrowserProcedureClient<TProcedure> = ProcedureClient<
  TProcedure,
  BrowserBoundaryError,
  TransportRequestOptions,
  "managed"
>;

export type BrowserClientRecord<TRecord> = ClientRecord<
  TRecord,
  BrowserBoundaryError,
  TransportRequestOptions,
  "managed"
>;

/** Every failure a browser client may observe, flattened into one public tagged union. */
export type BrowserClientErrorOf<TRouter> = ClientErrorOf<TRouter, BrowserBoundaryError>;

export type BrowserClientOf<TRouter> = BaseClientOf<
  TRouter,
  BrowserBoundaryError,
  TransportRequestOptions,
  "managed"
>;

export type { ClientErrorRegistry, ClientErrors, ResultSubscription };

/**
 * The wire-level breadcrumb stream. Every operation the client performs emits
 * structured events — no values, only paths, tags, and timing, so the stream
 * is safe to forward to error trackers verbatim. One `onEvent` feeds Sentry
 * breadcrumbs, metrics, or a devtools timeline without touching call sites.
 */
export type ClientEvent =
  | Readonly<{ type: "call"; kind: "query" | "mutation" | "subscription"; path: string }>
  | Readonly<{
      type: "success";
      kind: "query" | "mutation" | "subscription";
      path: string;
      durationMs: number;
    }>
  | Readonly<{
      type: "failure";
      kind: "query" | "mutation" | "subscription";
      path: string;
      tag: string;
      durationMs: number;
    }>
  | Readonly<{ type: "retry"; path: string; tag: string; attempt: number; delayMs: number }>
  | Readonly<{
      /** A shell took ownership of a failure beneath it. */
      type: "claimed";
      path: string;
      tag: string;
      owner: string;
      effect: "pause" | "escalate";
    }>
  | Readonly<{
      /** The server's contract digest stopped matching this client's — a
       * deploy left this client behind. Emitted once per client. */
      type: "skew";
      clientContract: string;
      serverContract: string;
    }>;

export type ClientEventListener = (event: ClientEvent) => void;

export interface CreateContractClientOptions<
  TRouter extends RouterContract<any, ContractRouterRecord>,
> {
  /** Runtime contract used to encode inputs and validate outputs and errors. */
  readonly contract: TRouter;
  readonly transport: ClientTransport;
  readonly onEvent?: ClientEventListener;
  /** Overrides the automatic contract digest; set the same value server-side. */
  readonly contractVersion?: string;
}

export interface CreateRouterClientOptions<TRouter extends Router<any, RouterRecord>> {
  /** Full server routers are accepted for colocated or migration use. */
  readonly router: TRouter;
  readonly transport: ClientTransport;
  readonly onEvent?: ClientEventListener;
  /** Overrides the automatic contract digest; set the same value server-side. */
  readonly contractVersion?: string;
}

export type CreateBrowserClientOptions<TRouter extends ClientRouter> =
  TRouter extends RouterContract<any, ContractRouterRecord>
    ? CreateContractClientOptions<TRouter>
    : TRouter extends Router<any, RouterRecord>
      ? CreateRouterClientOptions<TRouter>
      : never;

const clientEventListeners = new WeakMap<object, ClientEventListener>();

/** Internal: the event listener registered for a client, by client identity. */
export const getClientEventListener = (clientIdentity: object): ClientEventListener | undefined =>
  clientEventListeners.get(clientIdentity);

export { getClientIdentity, getClientRouter, getProcedureClientMetadata };
export type { ProcedureClientMetadata };

const clientFailure = (
  outcome: Exclude<Awaited<ReturnType<ClientTransport["request"]>>, { ok: true }>,
) => {
  switch (outcome.reason) {
    case "offline":
      return ClientOffline({});
    // A fetch rejection is AMBIGUOUS — DNS failure (never sent) and a
    // connection dropped mid-response (sent, maybe processed) look the same.
    // `retryable` means "provably never left the client", so: false.
    case "network":
      return ClientNetworkFailure({ retryable: false });
    case "timeout":
      return ClientTimeout({ timeoutMs: outcome.timeoutMs });
  }
};

const decodeEnvelope = (
  procedure: ClientProcedure,
  envelope: ResponseEnvelope,
  status: number,
): Result<unknown, AnyTaggedError> => {
  try {
    if (envelope.ok) {
      if (status < 200 || status >= 300) {
        return err(ClientProtocolViolation({ reason: "envelope" }));
      }
      const decoded = procedure._def.output.decode(envelope.value);
      return decoded.ok ? ok(decoded.value) : err(ClientDecodeFailure({ target: "success" }));
    }
    for (const framework of [ServerInternal, ServerBadRequest] as const) {
      if (framework.tag !== envelope.error._tag) continue;
      if (status !== framework.policy.httpStatus && status !== 200) {
        return err(ClientProtocolViolation({ reason: "envelope" }));
      }
      const decoded = framework.decode(envelope.error);
      return decoded.ok ? err(decoded.value) : err(ClientDecodeFailure({ target: "error" }));
    }
    const definitions = procedure._def.definitions as ErrorDefinitionMap;
    const definition = Object.values(definitions).find(
      (candidate) => candidate.tag === envelope.error._tag,
    );
    if (!definition) return err(ClientProtocolViolation({ reason: "unknown-tag" }));
    const decoded = definition.decode(envelope.error);
    if (!decoded.ok) return err(ClientDecodeFailure({ target: "error" }));
    if (status !== definition.policy.httpStatus && status !== 200) {
      return err(ClientProtocolViolation({ reason: "envelope" }));
    }
    return err(decoded.value);
  } catch {
    return err(ClientDecodeFailure({ target: envelope.ok ? "success" : "error" }));
  }
};

/**
 * Contract-skew reconciliation. The server stamps every response with its
 * contract digest; when it stops matching this client's, the client is a
 * stale deploy. Contract-shaped failures are then reclassified into
 * `client/stale` (whose built-in shell reloads), and a `skew` event fires
 * once. Matching digests leave every failure exactly as it was — a real
 * defect stays a defect.
 */
interface SkewMonitor {
  reconcile(
    result: Result<unknown, AnyTaggedError>,
    serverContract: string | undefined,
  ): Result<unknown, AnyTaggedError>;
}

const createSkewMonitor = (
  contract: string,
  onEvent: ClientEventListener | undefined,
): SkewMonitor => {
  let reported = false;
  return {
    reconcile: (result, serverContract) => {
      if (serverContract === undefined || serverContract === contract) return result;
      if (!reported) {
        reported = true;
        onEvent?.({ type: "skew", clientContract: contract, serverContract });
      }
      if (!result.ok && STALE_RECLASSIFIABLE_TAGS.has(result.error._tag)) {
        return err(ClientStale({ reclassifiedFrom: result.error._tag }));
      }
      return result;
    },
  };
};

const callProcedureOnce = async (
  procedure: ClientProcedure,
  path: string,
  input: unknown,
  transport: ClientTransport,
  skew: SkewMonitor,
  options?: TransportRequestOptions,
): Promise<Result<unknown, AnyTaggedError>> => {
  const encodedInput = encodeProcedureInput(procedure._def.input, input);
  if (!encodedInput.ok) {
    const details = encodedInput.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
    throw new TypeError(`Invalid input for ${path}: ${details}`);
  }

  const outcome = await transport.request(requestEnvelope(path, encodedInput.value), options);
  if (!outcome.ok) return err(clientFailure(outcome));

  const { response } = outcome;
  return skew.reconcile(decodeTransportResponse(procedure, response), response.contract);
};

const decodeTransportResponse = (
  procedure: ClientProcedure,
  response: TransportResponse,
): Result<unknown, AnyTaggedError> => {
  const isProtocolContent = isProtocolContentType(response.contentType);
  if (!isProtocolContent) {
    return err(
      response.status >= 400
        ? ClientHttpFailure({ status: response.status })
        : ClientProtocolViolation({ reason: "content-type" }),
    );
  }

  const decodedBody = deserialize(response.body, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
  if (!decodedBody.ok) {
    return err(
      response.status >= 400
        ? ClientHttpFailure({ status: response.status })
        : ClientProtocolViolation({ reason: "envelope" }),
    );
  }
  const raw = decodedBody.value;
  const envelope = decodeResponseEnvelope(raw);
  if (!envelope) {
    const versionMismatch = raw !== null && typeof raw === "object" && "v" in raw && raw.v !== 1;
    return err(
      ClientProtocolViolation({
        reason: versionMismatch ? "version" : "envelope",
      }),
    );
  }

  const result = decodeEnvelope(procedure, envelope, response.status);
  if (envelope.touched !== undefined) {
    const keys = envelope.touched.filter((key): key is string => typeof key === "string");
    if (keys.length > 0) recordTouchedEntities(result, keys);
  }
  return result;
};

const retryDelayFor = (
  procedure: ClientProcedure,
  kind: "query" | "mutation",
  failure: AnyTaggedError,
  attempt: number,
): number | undefined => {
  const definitions = {
    ...(procedure._def.definitions as ErrorDefinitionMap),
    ServerInternal,
    ClientOffline,
    ClientNetworkFailure,
    ClientTimeout,
    ClientHttpFailure,
    ClientProtocolViolation,
    ClientDecodeFailure,
    ClientStale,
  } as ErrorDefinitionMap;
  const definition = Object.values(definitions).find((candidate) => candidate.tag === failure._tag);
  // Never spin on offline while the browser still reports offline — the
  // recovery path is reconnect, not a retry timer.
  if (failure._tag === "client/offline" && !getOnlineSnapshot()) return undefined;
  if (!definition || definition.policy.retry === "never" || attempt >= 3) return undefined;
  // A mutation that died mid-flight is ambiguous — the server may have
  // processed it. Only provably-unsent (offline short-circuit) and
  // server-scheduled (retry: "after") failures retry for mutations.
  if (
    kind === "mutation" &&
    failure._tag !== "client/offline" &&
    definition.policy.retry !== "after"
  )
    return undefined;
  if (definition.policy.retry === "after") {
    const retryAfterMs =
      failure.data !== null &&
      typeof failure.data === "object" &&
      "retryAfterMs" in failure.data &&
      typeof failure.data.retryAfterMs === "number"
        ? failure.data.retryAfterMs
        : undefined;
    return retryAfterMs;
  }
  return Math.min(250 * 2 ** attempt, 2_000);
};

const waitForRetry = (delay: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(cancelled);
    };
    const timeout = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(0, delay),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const callProcedure = async (
  procedure: ClientProcedure,
  path: string,
  input: unknown,
  transport: ClientTransport,
  onEvent: ClientEventListener | undefined,
  skew: SkewMonitor,
  options?: TransportRequestOptions,
): Promise<Result<unknown, AnyTaggedError>> => {
  const kind = procedure._def.kind as "query" | "mutation";
  const startedAt = Date.now();
  onEvent?.({ type: "call", kind, path });
  for (let attempt = 0; ; attempt += 1) {
    const result = await callProcedureOnce(procedure, path, input, transport, skew, options);
    if (result.ok) {
      onEvent?.({ type: "success", kind, path, durationMs: Date.now() - startedAt });
      return result;
    }
    const delay =
      options?.retry === "from-error-policy"
        ? retryDelayFor(procedure, kind, result.error, attempt)
        : undefined;
    if (delay === undefined) {
      onEvent?.({
        type: "failure",
        kind,
        path,
        tag: result.error._tag,
        durationMs: Date.now() - startedAt,
      });
      return result;
    }
    onEvent?.({
      type: "retry",
      path,
      tag: result.error._tag,
      attempt: attempt + 1,
      delayMs: delay,
    });
    await waitForRetry(delay, options?.signal);
  }
};

const subscribeProcedure = <T, E extends AnyTaggedError>(
  procedure: ClientProcedure,
  path: string,
  input: unknown,
  transport: ClientTransport,
  onEvent: ClientEventListener | undefined,
  options: TransportRequestOptions = {},
): ResultSubscription<T, E> => {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  async function* stream(): AsyncGenerator<Result<T, E>> {
    const encodedInput = encodeProcedureInput(procedure._def.input, input);
    if (!encodedInput.ok) throw new TypeError(`Invalid input for ${path}`);
    if (!transport.stream) {
      yield err(ClientProtocolViolation({ reason: "content-type" })) as unknown as Result<T, E>;
      return;
    }
    const outcome = await transport.stream(requestEnvelope(path, encodedInput.value), {
      ...options,
      signal,
    });
    if (!outcome.ok) {
      yield err(clientFailure(outcome)) as Result<T, E>;
      return;
    }
    const { response } = outcome;
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !isStreamContentType(response.contentType) ||
      !response.body
    ) {
      yield err(
        response.status >= 400
          ? ClientHttpFailure({ status: response.status })
          : ClientProtocolViolation({ reason: "content-type" }),
      ) as unknown as Result<T, E>;
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let expectedSequence = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        if (new TextEncoder().encode(buffer).byteLength > DEFAULT_MAX_WIRE_BYTES) {
          yield err(ClientProtocolViolation({ reason: "envelope" })) as unknown as Result<T, E>;
          return;
        }
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length === 0) continue;
          const decoded = deserialize(line, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
          const frame = decoded.ok ? decodeStreamFrame(decoded.value) : undefined;
          if (!frame || frame.seq !== expectedSequence++) {
            yield err(ClientProtocolViolation({ reason: "envelope" })) as unknown as Result<T, E>;
            return;
          }
          if (frame.done) return;
          const result = decodeEnvelope(procedure, frame.response, 200) as Result<T, E>;
          yield result;
          if (!result.ok) return;
        }
        if (chunk.done) {
          yield err(ClientProtocolViolation({ reason: "envelope" })) as unknown as Result<T, E>;
          return;
        }
      }
    } catch (failure) {
      if (isCancelled(failure)) throw failure;
      yield err(ClientNetworkFailure({ retryable: false })) as unknown as Result<T, E>;
    } finally {
      reader.releaseLock();
    }
  }
  return {
    close: () => controller.abort(),
    async *[Symbol.asyncIterator]() {
      const startedAt = Date.now();
      onEvent?.({ type: "call", kind: "subscription", path });
      let last: Result<T, E> | undefined;
      for await (const result of stream()) {
        last = result;
        yield result;
      }
      if (last === undefined || last.ok) {
        onEvent?.({
          type: "success",
          kind: "subscription",
          path,
          durationMs: Date.now() - startedAt,
        });
      } else {
        onEvent?.({
          type: "failure",
          kind: "subscription",
          path,
          tag: (last.error as AnyTaggedError)._tag,
          durationMs: Date.now() - startedAt,
        });
      }
    },
  };
};

const createProxy = (
  router: ClientRouter,
  transport: ClientTransport,
  onEvent: ClientEventListener | undefined,
  skew: SkewMonitor,
  path: readonly string[],
  cache: Map<string, unknown>,
  clientIdentity: object,
  errorRegistry: ClientErrorRegistry<AnyPublicTaggedError>,
): unknown => {
  const procedurePath = path.join(".");
  const cached = cache.get(procedurePath);
  if (cached) return cached;
  const procedure = router.procedures.get(procedurePath);
  const proxy = new Proxy(() => undefined, {
    get: (_target, property) => {
      if (property === "$kind" && procedure) return procedure._def.kind;
      if (property === "$errors" && path.length === 0) return errorRegistry;
      if (typeof property !== "string") return undefined;
      const candidate = [...path, property];
      const candidatePath = candidate.join(".");
      // Only mint a sub-proxy for paths that actually lead somewhere in the
      // router. Everything else — `then` (await-safety), `valueOf`, `toJSON`,
      // `name`, dev-tooling introspection — reads `undefined` instead of a
      // callable that throws later inside whoever poked at it.
      const leadsSomewhere =
        router.procedures.has(candidatePath) ||
        [...router.procedures.keys()].some((key) => key.startsWith(`${candidatePath}.`));
      if (!leadsSomewhere) return undefined;
      return createProxy(
        router,
        transport,
        onEvent,
        skew,
        candidate,
        cache,
        clientIdentity,
        errorRegistry,
      );
    },
    apply: (_target, _thisArg, argumentsList: [unknown?, TransportRequestOptions?]) => {
      if (!procedure) throw new TypeError(`Unknown procedure ${procedurePath}`);
      const input = argumentsList.length === 0 ? {} : argumentsList[0];
      if (procedure._def.kind === "subscription") {
        return subscribeProcedure(
          procedure,
          procedurePath,
          input,
          transport,
          onEvent,
          argumentsList[1],
        );
      }
      return callProcedure(
        procedure,
        procedurePath,
        input,
        transport,
        onEvent,
        skew,
        argumentsList[1],
      );
    },
  });
  registerClientIdentity(proxy, clientIdentity);
  if (procedure) {
    registerProcedureClient(proxy, { path: procedurePath, procedure, clientIdentity });
  }
  cache.set(procedurePath, proxy);
  return proxy;
};

/**
 * A router (unlike a contract) holds the implemented procedures — handlers,
 * middleware, their imports. If one reaches a browser bundle, all of that
 * ships with it: server code, database drivers, secrets. Handing `router` to
 * `createBrowserClient` is that exact footgun, so warn once in dev.
 * Bundlers do NOT save you — a top-level `.handler()`/`.router()` call is not
 * tree-shaken. Build the client from a `contract()` defined in a module that
 * never imports server code. See /concepts/client-boundary.
 */
/**
 * Reads NODE_ENV without requiring `@types/node`: a browser-only consumer
 * compiles this library with `types: []`, so `process` may not be declared.
 * Bundlers still see the `process.env.NODE_ENV` text and strip dev branches.
 */
const isProductionEnv = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
    "NODE_ENV"
  ] === "production";

const clientBoundaryWarningState = { warned: false };

/** Test-only: reset the once-per-process router-in-browser warning. */
export const __resetClientBoundaryWarning = () => {
  clientBoundaryWarningState.warned = false;
};

const warnRouterInBrowser = () => {
  if (clientBoundaryWarningState.warned) return;
  // Dev-only, and behind a browser guard so servers never see it.
  const isProduction = isProductionEnv();
  const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
  if (isProduction || !isBrowser) return;
  clientBoundaryWarningState.warned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[result-rpc] createBrowserClient received a server `router`. The " +
      "router carries handlers, middleware, and their imports (db drivers, " +
      "secrets) — all of which are now in your client bundle. Pass a " +
      "`contract` defined in a server-code-free module instead. " +
      "See https://result-rpc.com/concepts/client-boundary",
  );
};

const createBrowserClientImplementation = (
  options:
    | CreateContractClientOptions<RouterContract<any, ContractRouterRecord>>
    | CreateRouterClientOptions<Router<any, RouterRecord>>,
  warnAboutRouter: boolean,
): BrowserClientOf<ClientRouter> => {
  const router = "contract" in options ? options.contract : options.router;
  if ("router" in options && warnAboutRouter) warnRouterInBrowser();
  const clientIdentity = Object.freeze({});
  registerClientIdentity(clientIdentity, clientIdentity, router);
  if (options.onEvent) clientEventListeners.set(clientIdentity, options.onEvent);
  const skew = createSkewMonitor(
    options.contractVersion ?? contractDigest(router),
    options.onEvent,
  );
  const errorRegistry = createClientErrorRegistry<AnyPublicTaggedError>(
    router,
    Object.values(frameworkErrorDefinitions),
  );
  return createProxy(
    router,
    options.transport,
    options.onEvent,
    skew,
    [],
    new Map(),
    clientIdentity,
    errorRegistry,
  ) as BrowserClientOf<ClientRouter>;
};

/** @internal Used only by the parity harness, which cannot enter a browser bundle. */
export const createParityBrowserClient = <TRouter extends Router<any, RouterRecord>>(
  options: CreateRouterClientOptions<TRouter>,
): BrowserClientOf<TRouter> =>
  createBrowserClientImplementation(
    options as CreateRouterClientOptions<Router<any, RouterRecord>>,
    false,
  ) as BrowserClientOf<TRouter>;

export function createBrowserClient<TRouter extends RouterContract<any, ContractRouterRecord>>(
  options: CreateContractClientOptions<TRouter>,
): BrowserClientOf<TRouter>;
export function createBrowserClient<TRouter extends Router<any, RouterRecord>>(
  options: CreateRouterClientOptions<TRouter>,
): BrowserClientOf<TRouter>;
export function createBrowserClient(
  options:
    | CreateContractClientOptions<RouterContract<any, ContractRouterRecord>>
    | CreateRouterClientOptions<Router<any, RouterRecord>>,
): BrowserClientOf<ClientRouter> {
  return createBrowserClientImplementation(options, true);
}

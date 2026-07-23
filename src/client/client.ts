import type { AnyTaggedError } from "../error.js";
import {
  ClientDecodeFailure,
  ServerBadRequest,
  ClientHttpFailure,
  ClientNetworkFailure,
  ClientOffline,
  ClientProtocolViolation,
  ClientTimeout,
  ServerInternal,
  type ClientBoundaryError,
} from "../framework-errors.js";
import {
  decodeStreamFrame,
  decodeResponseEnvelope,
  isProtocolContentType,
  isStreamContentType,
  type ResponseEnvelope,
} from "../protocol.js";
import { err, ok, type Result } from "../result.js";
import { DEFAULT_MAX_WIRE_BYTES, deserialize } from "../serializer.js";
import type {
  AnyProcedure,
  AnyProcedureContract,
  ContractRouterRecord,
  ErrorDefinitionMap,
  ErrorUnion,
  Procedure,
  ProcedureContract,
  SubscriptionProcedure,
  Router,
  RouterContract,
  RouterRecord,
} from "../server/contract.js";
import {
  cancelled,
  isCancelled,
  requestEnvelope,
  type ClientTransport,
  type TransportRequestOptions,
} from "./transport.js";

/** Zero-input procedures may be called with no argument. */
export type ClientInputArgs<TInput> = Record<never, never> extends TInput
  ? [input?: TInput, options?: TransportRequestOptions]
  : [input: TInput, options?: TransportRequestOptions];

export type ProcedureClient<TProcedure> =
  TProcedure extends SubscriptionProcedure<any, infer TInput, infer TOutput, infer TDefinitions>
    ? SubscriptionClient<TInput, TOutput, TDefinitions>
    : TProcedure extends Procedure<any, infer TInput, infer TOutput, infer TDefinitions, infer TKind>
    ? TKind extends "subscription"
      ? SubscriptionClient<TInput, TOutput, TDefinitions>
      : ((
        ...args: ClientInputArgs<TInput>
      ) => Promise<Result<
        TOutput,
        ErrorUnion<TDefinitions> | ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest> | ClientBoundaryError
      >>) & { readonly $kind: TKind }
    : TProcedure extends ProcedureContract<any, infer TInput, infer TOutput, infer TDefinitions, infer TKind>
      ? TKind extends "subscription"
        ? SubscriptionClient<TInput, TOutput, TDefinitions>
        : ((
          ...args: ClientInputArgs<TInput>
        ) => Promise<Result<
          TOutput,
          ErrorUnion<TDefinitions> | ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest> | ClientBoundaryError
        >>) & { readonly $kind: TKind }
    : never;

type ClientProcedure = AnyProcedure | AnyProcedureContract;
type ClientRouterRecord = RouterRecord | ContractRouterRecord;
type ClientRouter =
  | Router<any, RouterRecord>
  | RouterContract<any, ContractRouterRecord>;

export type ClientRecord<TRecord> = {
  readonly [TKey in keyof TRecord]: TRecord[TKey] extends ClientProcedure
    ? ProcedureClient<TRecord[TKey]>
    : TRecord[TKey] extends ClientRouterRecord
      ? ClientRecord<TRecord[TKey]>
      : never;
};

export interface ResultSubscription<T, E extends AnyTaggedError>
  extends AsyncIterable<Result<T, E>> {
  close(): void;
}

type SubscriptionClient<TInput, TOutput, TDefinitions extends ErrorDefinitionMap> = ((
  input: TInput,
  options?: TransportRequestOptions,
) => ResultSubscription<
  TOutput,
  ErrorUnion<TDefinitions> | ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest> | ClientBoundaryError
>) & { readonly $kind: "subscription" };

export type ClientOf<TRouter> = TRouter extends Router<any, infer TRecord>
  ? ClientRecord<TRecord>
  : TRouter extends RouterContract<any, infer TRecord>
    ? ClientRecord<TRecord>
    : never;

export interface CreateContractClientOptions<
  TRouter extends RouterContract<any, ContractRouterRecord>,
> {
  /** Runtime contract used to encode inputs and validate outputs and errors. */
  readonly contract: TRouter;
  readonly transport: ClientTransport;
}

export interface CreateRouterClientOptions<TRouter extends Router<any, RouterRecord>> {
  /** Full server routers are accepted for colocated or migration use. */
  readonly router: TRouter;
  readonly transport: ClientTransport;
}

export type CreateClientOptions<TRouter extends ClientRouter> =
  TRouter extends RouterContract<any, ContractRouterRecord>
    ? CreateContractClientOptions<TRouter>
    : TRouter extends Router<any, RouterRecord>
      ? CreateRouterClientOptions<TRouter>
      : never;

export interface ProcedureClientMetadata {
  readonly path: string;
  readonly procedure: ClientProcedure;
  readonly clientIdentity: object;
}

const procedureClientMetadata = new WeakMap<Function, ProcedureClientMetadata>();
const clientIdentities = new WeakMap<object, object>();

export const getProcedureClientMetadata = (
  value: Function,
): ProcedureClientMetadata | undefined => procedureClientMetadata.get(value);

export const getClientIdentity = (value: object): object | undefined =>
  clientIdentities.get(value);

const clientFailure = (outcome: Exclude<Awaited<ReturnType<ClientTransport["request"]>>, { ok: true }>) => {
  switch (outcome.reason) {
    case "offline": return ClientOffline({});
    case "network": return ClientNetworkFailure({ retryable: true });
    case "timeout": return ClientTimeout({ timeoutMs: outcome.timeoutMs });
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
    if (!framework.is(envelope.error)) continue;
    if (status !== framework.policy.httpStatus && status !== 200) {
      return err(ClientProtocolViolation({ reason: "envelope" }));
    }
    const decoded = framework.decode(envelope.error);
    return decoded.ok
      ? err(decoded.value)
      : err(ClientDecodeFailure({ target: "error" }));
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

const callProcedureOnce = async (
  procedure: ClientProcedure,
  path: string,
  input: unknown,
  transport: ClientTransport,
  options?: TransportRequestOptions,
): Promise<Result<unknown, AnyTaggedError>> => {
  const encodedInput = procedure._def.input.encode(input ?? {});
  if (!encodedInput.ok) {
    const details = encodedInput.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
    throw new TypeError(`Invalid input for ${path}: ${details}`);
  }

  const outcome = await transport.request(requestEnvelope(path, encodedInput.value), options);
  if (!outcome.ok) return err(clientFailure(outcome));

  const { response } = outcome;
  const isProtocolContent = isProtocolContentType(response.contentType);
  if (!isProtocolContent) {
    return err(response.status >= 400
      ? ClientHttpFailure({ status: response.status })
      : ClientProtocolViolation({ reason: "content-type" }));
  }

  const decodedBody = deserialize(response.body, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
  if (!decodedBody.ok) {
    return err(response.status >= 400
      ? ClientHttpFailure({ status: response.status })
      : ClientProtocolViolation({ reason: "envelope" }));
  }
  const raw = decodedBody.value;
  const envelope = decodeResponseEnvelope(raw);
  if (!envelope) {
    const versionMismatch = raw !== null
      && typeof raw === "object"
      && "v" in raw
      && raw.v !== 1;
    return err(ClientProtocolViolation({
      reason: versionMismatch ? "version" : "envelope",
    }));
  }

  return decodeEnvelope(procedure, envelope, response.status);
};

const retryDelayFor = (
  procedure: ClientProcedure,
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
  } as ErrorDefinitionMap;
  const definition = Object.values(definitions).find(
    (candidate) => candidate.tag === failure._tag,
  );
  if (!definition || definition.policy.retry === "never" || attempt >= 3) return undefined;
  if (definition.policy.retry === "after") {
    const retryAfterMs = failure.data !== null
      && typeof failure.data === "object"
      && "retryAfterMs" in failure.data
      && typeof failure.data.retryAfterMs === "number"
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
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, delay));
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const callProcedure = async (
  procedure: ClientProcedure,
  path: string,
  input: unknown,
  transport: ClientTransport,
  options?: TransportRequestOptions,
): Promise<Result<unknown, AnyTaggedError>> => {
  for (let attempt = 0; ; attempt += 1) {
    const result = await callProcedureOnce(procedure, path, input, transport, options);
    if (result.ok || options?.retry !== "from-error-policy") return result;
    const delay = retryDelayFor(procedure, result.error, attempt);
    if (delay === undefined) return result;
    await waitForRetry(delay, options.signal);
  }
};

const subscribeProcedure = <T, E extends AnyTaggedError>(
  procedure: ClientProcedure,
  path: string,
  input: unknown,
  transport: ClientTransport,
  options: TransportRequestOptions = {},
): ResultSubscription<T, E> => {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  return {
    close: () => controller.abort(),
    async *[Symbol.asyncIterator]() {
      const encodedInput = procedure._def.input.encode(input);
      if (!encodedInput.ok) throw new TypeError(`Invalid input for ${path}`);
      if (!transport.stream) {
        yield err(ClientProtocolViolation({ reason: "content-type" })) as unknown as Result<T, E>;
        return;
      }
      const outcome = await transport.stream(
        requestEnvelope(path, encodedInput.value),
        { ...options, signal },
      );
      if (!outcome.ok) {
        yield err(clientFailure(outcome)) as Result<T, E>;
        return;
      }
      const { response } = outcome;
      if (
        response.status < 200
        || response.status >= 300
        || !isStreamContentType(response.contentType)
        || !response.body
      ) {
        yield err(response.status >= 400
          ? ClientHttpFailure({ status: response.status })
          : ClientProtocolViolation({ reason: "content-type" })) as unknown as Result<T, E>;
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
        yield err(ClientNetworkFailure({ retryable: true })) as unknown as Result<T, E>;
      } finally {
        reader.releaseLock();
      }
    },
  };
};

const createProxy = (
  router: ClientRouter,
  transport: ClientTransport,
  path: readonly string[],
  cache: Map<string, unknown>,
  clientIdentity: object,
): unknown => {
  const procedurePath = path.join(".");
  const cached = cache.get(procedurePath);
  if (cached) return cached;
  const procedure = router.procedures.get(procedurePath);
  const proxy = new Proxy(() => undefined, {
    get: (_target, property) => {
      if (property === "$kind" && procedure) return procedure._def.kind;
      if (typeof property !== "string") return undefined;
      const candidate = [...path, property];
      const candidatePath = candidate.join(".");
      // Await-safety: the thenable check on `await client` (or any promise
      // resolving to a proxy node) reads `.then`. Only follow the property if
      // it actually leads somewhere in the router.
      if (property === "then") {
        const leadsSomewhere = router.procedures.has(candidatePath)
          || [...router.procedures.keys()].some((key) => key.startsWith(`${candidatePath}.`));
        if (!leadsSomewhere) return undefined;
      }
      return createProxy(router, transport, candidate, cache, clientIdentity);
    },
    apply: (_target, _thisArg, argumentsList: [unknown, TransportRequestOptions?]) => {
      if (!procedure) throw new TypeError(`Unknown procedure ${procedurePath}`);
      if (procedure._def.kind === "subscription") {
        return subscribeProcedure(
          procedure,
          procedurePath,
          argumentsList[0],
          transport,
          argumentsList[1],
        );
      }
      return callProcedure(procedure, procedurePath, argumentsList[0], transport, argumentsList[1]);
    },
  });
  clientIdentities.set(proxy, clientIdentity);
  if (procedure) {
    procedureClientMetadata.set(proxy, { path: procedurePath, procedure, clientIdentity });
  }
  cache.set(procedurePath, proxy);
  return proxy;
};

export function createClient<
  TRouter extends RouterContract<any, ContractRouterRecord>,
>(options: CreateContractClientOptions<TRouter>): ClientOf<TRouter>;
export function createClient<TRouter extends Router<any, RouterRecord>>(
  options: CreateRouterClientOptions<TRouter>,
): ClientOf<TRouter>;
export function createClient(
  options:
    | CreateContractClientOptions<RouterContract<any, ContractRouterRecord>>
    | CreateRouterClientOptions<Router<any, RouterRecord>>,
): ClientOf<ClientRouter> {
  const router = "contract" in options ? options.contract : options.router;
  const clientIdentity = Object.freeze({});
  return createProxy(
    router,
    options.transport,
    [],
    new Map(),
    clientIdentity,
  ) as ClientOf<ClientRouter>;
}

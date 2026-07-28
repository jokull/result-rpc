import { createClient, registerClientLike, type ClientOf } from "../client/client.js";
import { fetchTransport } from "../client/transport.js";
import type { ServerBadRequest, ServerInternal } from "../framework-errors.js";
import type { Result } from "../result.js";
import {
  executeProcedure,
  executeSubscription,
  type AnyProcedure,
  type ErrorDefinitionMap,
  type ErrorUnion,
  type InternalErrorEvent,
  type Procedure,
  type Router,
  type RouterContext,
  type RouterRecord,
  type SubscriptionProcedure,
} from "./contract.js";
import { createFetchHandler } from "./http.js";

/**
 * The failures a server-side call can actually produce. The client boundary
 * tags are absent because they are unreachable in-process: there is no socket
 * to drop, no `navigator` to report offline, and no second build to drift from
 * — so `client/offline`, `client/network-failure`, `client/timeout`,
 * `client/http-failure`, `client/protocol-violation`, `client/decode-failure`
 * and `client/stale` cannot occur. Narrowing the union here is honesty, not
 * convenience: it is what makes an exhaustive `matchError` in a server
 * component a few arms instead of a dozen.
 */
export type ServerCallerError<TDefinitions extends ErrorDefinitionMap> =
  | ErrorUnion<TDefinitions>
  | ReturnType<typeof ServerInternal>
  | ReturnType<typeof ServerBadRequest>;

export interface ServerCallOptions {
  /** Passed through to the handler as its caller-lifetime signal. */
  readonly signal?: AbortSignal;
}

/** Zero-input procedures may be called with no argument. */
export type ServerCallArgs<TInput> =
  Record<never, never> extends TInput
    ? [input?: TInput, options?: ServerCallOptions]
    : [input: TInput, options?: ServerCallOptions];

export type ServerProcedureCaller<TProcedure> =
  TProcedure extends SubscriptionProcedure<any, infer TInput, infer TOutput, infer TDefinitions>
    ? ((
        input: TInput,
        options?: ServerCallOptions,
      ) => AsyncIterable<Result<TOutput, ServerCallerError<TDefinitions>>>) & {
        readonly $kind: "subscription";
      }
    : TProcedure extends Procedure<
          any,
          infer TInput,
          infer TOutput,
          infer TDefinitions,
          infer TKind
        >
      ? TKind extends "subscription"
        ? ((
            input: TInput,
            options?: ServerCallOptions,
          ) => AsyncIterable<Result<TOutput, ServerCallerError<TDefinitions>>>) & {
            readonly $kind: "subscription";
          }
        : ((
            ...args: ServerCallArgs<TInput>
          ) => Promise<Result<TOutput, ServerCallerError<TDefinitions>>>) & {
            readonly $kind: TKind;
          }
      : never;

export type ServerCallerRecord<TRecord> = {
  readonly [TKey in keyof TRecord]: TRecord[TKey] extends AnyProcedure
    ? ServerProcedureCaller<TRecord[TKey]>
    : TRecord[TKey] extends RouterRecord
      ? ServerCallerRecord<TRecord[TKey]>
      : never;
};

export type ServerCallerOf<TRouter> =
  TRouter extends Router<any, infer TRecord> ? ServerCallerRecord<TRecord> : never;

export interface CreateServerClientOptions<TRouter extends Router<any, RouterRecord>> {
  /**
   * `"parity"` routes every call through the real wire — serializer, envelope,
   * HTTP handler — so tests prove wire safety. `"direct"` calls the procedure
   * in-process, which skips the round trip and narrows the error union to what
   * is actually reachable on a server.
   */
  readonly mode: "parity" | "direct";
  readonly context: RouterContext<TRouter>;
  readonly onInternalError?: (event: InternalErrorEvent) => void;
}

const isProcedure = (value: AnyProcedure | RouterRecord): value is AnyProcedure =>
  "_kind" in value && (value._kind === "procedure" || value._kind === "subscription-procedure");

/**
 * A caller that runs procedures in-process. It keeps everything that decides
 * whether a call is correct — the middleware chain and its context, input
 * validation, output encode/decode (which also brands entities), and the
 * sanitization of private errors into `server/internal` — and drops only the
 * transport: no devalue round trip, no HTTP envelope, no contract digest, no
 * retry, no batching.
 *
 * Note that a mutation called this way executes normally but its cache
 * declarations are inert: `.affects()`, entity patching, and `touch` are
 * client-runtime behaviors, and there is no client cache on a server.
 */
const createDirectCaller = <TRouter extends Router<any, RouterRecord>>(
  router: TRouter,
  options: CreateServerClientOptions<TRouter>,
): ServerCallerOf<TRouter> => {
  const registry = new Map<string, { readonly fn: Function; readonly procedure: AnyProcedure }>();

  const executionOptions = (path: string, call: ServerCallOptions | undefined) => ({
    context: options.context,
    procedurePath: path,
    ...(call?.signal === undefined ? {} : { signal: call.signal }),
    ...(options.onInternalError === undefined ? {} : { onInternalError: options.onInternalError }),
  });

  const callable = (procedure: AnyProcedure, path: string): Function => {
    const fn =
      procedure._kind === "subscription-procedure"
        ? (input: unknown, call?: ServerCallOptions) =>
            executeSubscription(procedure, input as never, executionOptions(path, call) as never)
        : (input?: unknown, call?: ServerCallOptions) =>
            executeProcedure(
              procedure as never,
              (input ?? {}) as never,
              executionOptions(path, call) as never,
            );
    Object.defineProperty(fn, "$kind", { value: procedure._def.kind, enumerable: true });
    registry.set(path, { fn, procedure });
    return fn;
  };

  const build = (node: RouterRecord, prefix: readonly string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key];
      out[key] = isProcedure(value)
        ? callable(value, path.join("."))
        : build(value as RouterRecord, path);
    }
    return out;
  };

  const caller = build(router.record, []);
  // Registered under the same identity maps as a wire client, so the query
  // runtime accepts it for `prefetch` and `dehydrate` during server rendering.
  registerClientLike(caller, router as never, registry as never);
  return caller as ServerCallerOf<TRouter>;
};

export function createServerClient<TRouter extends Router<any, RouterRecord>>(
  router: TRouter,
  options: CreateServerClientOptions<TRouter> & { readonly mode: "parity" },
): ClientOf<TRouter>;
export function createServerClient<TRouter extends Router<any, RouterRecord>>(
  router: TRouter,
  options: CreateServerClientOptions<TRouter> & { readonly mode: "direct" },
): ServerCallerOf<TRouter>;
export function createServerClient<TRouter extends Router<any, RouterRecord>>(
  router: TRouter,
  options: CreateServerClientOptions<TRouter>,
): ClientOf<TRouter> | ServerCallerOf<TRouter> {
  if (options.mode === "direct") return createDirectCaller(router, options);
  const handler = createFetchHandler({
    router,
    createContext: () => options.context,
    ...(options.onInternalError === undefined ? {} : { onInternalError: options.onInternalError }),
  });
  const localFetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(new Request(input, init))) as typeof globalThis.fetch;
  return createClient({
    router,
    transport: fetchTransport({
      url: "http://result-rpc.local/rpc",
      fetch: localFetch,
    }),
  });
}

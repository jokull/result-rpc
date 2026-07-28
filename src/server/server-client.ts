import {
  createClientErrorRegistry,
  type BaseClientOf,
  type ClientCallArgs,
  type ClientErrorOf,
  type ClientRecord,
  type ProcedureClient,
} from "../client/base-client.js";
import { registerClientLike } from "../client/client-metadata.js";
import { ServerBadRequest, ServerInternal } from "../framework-errors.js";
import {
  executeProcedure,
  executeSubscription,
  type AnyProcedure,
  type InternalErrorEvent,
  type Router,
  type RouterContext,
  type RouterRecord,
} from "./contract.js";

/** Failures reachable while invoking a procedure directly in-process. */
export type ServerBoundaryError =
  | ReturnType<typeof ServerInternal>
  | ReturnType<typeof ServerBadRequest>;

export interface ServerCallOptions {
  /** Passed through to the handler as its caller-lifetime signal. */
  readonly signal?: AbortSignal;
}

export type ServerCallArgs<TInput> = ClientCallArgs<TInput, ServerCallOptions>;

export type ServerProcedureClient<TProcedure> = ProcedureClient<
  TProcedure,
  ServerBoundaryError,
  ServerCallOptions,
  "iterable"
>;

export type ServerClientRecord<TRecord> = ClientRecord<
  TRecord,
  ServerBoundaryError,
  ServerCallOptions,
  "iterable"
>;

export type ServerClientErrorOf<TRouter> = ClientErrorOf<TRouter, ServerBoundaryError>;

export type ServerClientOf<TRouter> = BaseClientOf<
  TRouter,
  ServerBoundaryError,
  ServerCallOptions,
  "iterable"
>;

export interface CreateServerClientOptions<TRouter extends Router<any, RouterRecord>> {
  readonly context: RouterContext<TRouter>;
  readonly onInternalError?: (event: InternalErrorEvent) => void;
  /**
   * Collects what `.headers()` procedures write. Pass the response's headers
   * from a server action or route handler to make a login mutation's cookie
   * land; omit it and the writes go to a detached `Headers` and are discarded,
   * like cache declarations are here.
   */
  readonly responseHeaders?: Headers;
}

const isProcedure = (value: AnyProcedure | RouterRecord): value is AnyProcedure =>
  "_kind" in value && (value._kind === "procedure" || value._kind === "subscription-procedure");

/**
 * Builds a direct, in-process server client. Middleware, input/output codecs,
 * entity branding, and private-error sanitization still run; transport,
 * envelopes, retries, batching, and browser boundary errors do not.
 *
 * Mutations execute normally, but cache declarations are inert because there
 * is no browser cache to patch or invalidate.
 */
export const createServerClient = <TRouter extends Router<any, RouterRecord>>(
  router: TRouter,
  options: CreateServerClientOptions<TRouter>,
): ServerClientOf<TRouter> => {
  const registry = new Map<string, { readonly fn: Function; readonly procedure: AnyProcedure }>();

  const executionOptions = (path: string, call: ServerCallOptions | undefined) => ({
    context: options.context,
    procedurePath: path,
    ...(options.responseHeaders === undefined ? {} : { responseHeaders: options.responseHeaders }),
    ...(call?.signal === undefined ? {} : { signal: call.signal }),
    ...(options.onInternalError === undefined ? {} : { onInternalError: options.onInternalError }),
  });

  const callable = (procedure: AnyProcedure, path: string): Function => {
    const fn = (...args: [unknown?, ServerCallOptions?]) => {
      const input = args.length === 0 ? {} : args[0];
      return procedure._kind === "subscription-procedure"
        ? executeSubscription(procedure, input as never, executionOptions(path, args[1]) as never)
        : executeProcedure(
            procedure as never,
            input as never,
            executionOptions(path, args[1]) as never,
          );
    };
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

  const client = build(router.record, []);
  Object.defineProperty(client, "$errors", {
    value: createClientErrorRegistry<ServerClientErrorOf<TRouter>>(router, [
      ServerBadRequest,
      ServerInternal,
    ]),
    enumerable: true,
  });
  registerClientLike(client, router, registry);
  return client as ServerClientOf<TRouter>;
};

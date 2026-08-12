import { type BaseClientOf, type ClientCallArgs, type ClientErrorOf, type ClientRecord, type ProcedureClient } from "../client/base-client.js";
import { type EffectiveContractVersion } from "../contract-digest.js";
import { ServerBadRequest, ServerInternal } from "../framework-errors.js";
import { type AnyRouter, type InternalErrorEvent, type RouterContext } from "./contract.js";
/** Failures reachable while invoking a procedure directly in-process. */
export type ServerBoundaryError = ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest>;
export interface ServerCallOptions {
    /** Passed through to the handler as its caller-lifetime signal. */
    readonly signal?: AbortSignal;
}
export type ServerCallArgs<TInput> = ClientCallArgs<TInput, ServerCallOptions>;
export type ServerProcedureClient<TProcedure> = ProcedureClient<TProcedure, ServerBoundaryError, ServerCallOptions, "iterable">;
export type ServerClientRecord<TRecord> = ClientRecord<TRecord, ServerBoundaryError, ServerCallOptions, "iterable">;
export type ServerClientErrorOf<TRouter> = ClientErrorOf<TRouter, ServerBoundaryError>;
export type ServerClientOf<TRouter> = BaseClientOf<TRouter, ServerBoundaryError, ServerCallOptions, "iterable">;
export interface CreateServerClientOptions<TRouter extends AnyRouter> {
    readonly context: RouterContext<TRouter>;
    readonly onInternalError?: (event: InternalErrorEvent) => void;
    /** Overrides the automatic digest used to bind dehydrated RSC state. */
    readonly contractVersion?: EffectiveContractVersion;
    /**
     * Collects what `.headers()` procedures write. Pass the response's headers
     * from a server action or route handler to make a login mutation's cookie
     * land; omit it and the writes go to a detached `Headers` and are discarded,
     * like cache declarations are here.
     */
    readonly responseHeaders?: Headers;
}
/**
 * Builds a direct, in-process server client. Middleware, input/output codecs,
 * entity branding, and private-error sanitization still run; transport,
 * envelopes, retries, batching, and browser boundary errors do not.
 *
 * Mutations execute normally, but cache declarations are inert because there
 * is no browser cache to patch or invalidate.
 */
export declare const createServerClient: <TRouter extends AnyRouter>(router: TRouter, options: CreateServerClientOptions<TRouter>) => ServerClientOf<TRouter>;

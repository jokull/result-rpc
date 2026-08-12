import type { AnyTaggedError, ErrorPolicy } from "../error.js";
import { type EffectiveContractVersion } from "../contract-digest.js";
import { type AnyRouter, type InternalErrorEvent, type RouterContext } from "./contract.js";
export interface FetchHandlerOptions<TRouter extends AnyRouter> {
    readonly router: TRouter;
    readonly endpoint?: string;
    readonly maxBatchItems?: number;
    readonly maxRequestBytes?: number;
    /**
     * Builds the per-request context. Note what is absent: response headers.
     * Writing one is a declared capability — a procedure calls `.headers()` and
     * receives `context.headers` — so that the contract records which calls
     * cannot have their response headers sent before the handler finishes.
     */
    readonly createContext: (options: {
        readonly request: Request;
    }) => RouterContext<TRouter> | Promise<RouterContext<TRouter>>;
    readonly onInternalError?: (event: InternalErrorEvent) => void;
    /**
     * Observability tap for every declared error that crosses the wire —
     * domain errors, bad requests, and sanitized internals alike. Receives the
     * error value plus its policy and the operation's HTTP status projection,
     * so one hook feeds
     * metrics and logging without re-deriving anything. Defects additionally
     * fire `onInternalError` with the full cause. Batch and streaming envelopes
     * can remain HTTP 200 while this event carries the individual operation's
     * projected status.
     */
    readonly onError?: (event: ErrorResponseEvent) => void;
    /**
     * Overrides the automatic contract digest to form the effective version sent
     * on every response for stale-
     * client detection (e.g. a build stamp). Set the same value on the client.
     */
    readonly contractVersion?: EffectiveContractVersion;
}
export interface ErrorResponseEvent {
    readonly error: AnyTaggedError;
    readonly policy?: ErrorPolicy;
    readonly procedurePath?: string;
    readonly httpStatus: number;
}
export declare const createFetchHandler: <TRouter extends AnyRouter>(options: FetchHandlerOptions<TRouter>) => ((request: Request) => Promise<Response>);

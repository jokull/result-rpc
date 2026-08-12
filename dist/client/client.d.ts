import { ServerBadRequest, ServerInternal, type ClientBoundaryError } from "../framework-errors.js";
import { type EffectiveContractVersion } from "../contract-digest.js";
import type { AnyRouterContract } from "../server/contract.js";
import { type BaseClientOf, type ClientErrorOf, type ClientErrorRegistry, type ClientErrors, type ClientRecord, type ClientRouter, type ProcedureClient, type ResultSubscription } from "./base-client.js";
import { getClientIdentity, getClientRouter, getProcedureClientMetadata, type ProcedureClientMetadata } from "./client-metadata.js";
import { type ClientTransport, type TransportRequestOptions } from "./transport.js";
export type BrowserBoundaryError = ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest> | ClientBoundaryError;
export type BrowserProcedureClient<TProcedure> = ProcedureClient<TProcedure, BrowserBoundaryError, TransportRequestOptions, "managed">;
export type BrowserClientRecord<TRecord> = ClientRecord<TRecord, BrowserBoundaryError, TransportRequestOptions, "managed">;
/** Every failure a browser client may observe, flattened into one public tagged union. */
export type BrowserClientErrorOf<TRouter> = ClientErrorOf<TRouter, BrowserBoundaryError>;
export type BrowserClientOf<TRouter> = BaseClientOf<TRouter, BrowserBoundaryError, TransportRequestOptions, "managed">;
export type { ClientErrorRegistry, ClientErrors, ResultSubscription };
/**
 * The wire-level breadcrumb stream. Every operation the client performs emits
 * structured events — no values, only paths, tags, and timing, so the stream
 * is safe to forward to error trackers verbatim. One `onEvent` feeds Sentry
 * breadcrumbs, metrics, or a devtools timeline without touching call sites.
 */
export type ClientEvent = Readonly<{
    type: "call";
    kind: "query" | "mutation" | "subscription";
    path: string;
}> | Readonly<{
    type: "success";
    kind: "query" | "mutation" | "subscription";
    path: string;
    durationMs: number;
}> | Readonly<{
    type: "failure";
    kind: "query" | "mutation" | "subscription";
    path: string;
    tag: string;
    durationMs: number;
}> | Readonly<{
    type: "retry";
    path: string;
    tag: string;
    attempt: number;
    delayMs: number;
}> | Readonly<{
    /** A pausing shell held a failure beneath it. */
    type: "claimed";
    path: string;
    tag: string;
    owner: string;
    effect: "pause";
}> | Readonly<{
    /** The server's effective contract version stopped matching this client's — a
     * deploy left this client behind. Emitted once per client. */
    type: "skew";
    clientContract: string;
    serverContract: string;
}>;
export type ClientEventListener = (event: ClientEvent) => void;
export interface CreateBrowserClientOptions<TRouter extends AnyRouterContract> {
    /** Runtime contract used to encode inputs and validate outputs and errors. */
    readonly contract: TRouter;
    readonly transport: ClientTransport;
    readonly onEvent?: ClientEventListener;
    /** Overrides the automatic contract digest; set the same value server-side. */
    readonly contractVersion?: EffectiveContractVersion;
}
/** Internal: the event listener registered for a client, by client identity. */
export declare const getClientEventListener: (clientIdentity: object) => ClientEventListener | undefined;
export { getClientIdentity, getClientRouter, getProcedureClientMetadata };
export type { ProcedureClientMetadata };
/** @internal Shared with `result-rpc/testing`; not exported from `result-rpc/client`. */
export declare const createClientRuntime: <TRouter extends ClientRouter>(router: TRouter, options: {
    readonly transport: ClientTransport;
    readonly onEvent?: ClientEventListener;
    readonly contractVersion?: EffectiveContractVersion;
}) => BrowserClientOf<TRouter>;
export declare const createBrowserClient: <TRouter extends AnyRouterContract>(options: CreateBrowserClientOptions<TRouter>) => BrowserClientOf<TRouter>;

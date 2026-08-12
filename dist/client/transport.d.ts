import { type RequestEnvelope } from "../protocol.js";
export declare const cancelled: Readonly<{
    _tag: "control/cancelled";
    data: Readonly<{}>;
}>;
export declare const isCancelled: (value: unknown) => value is typeof cancelled;
/**
 * The control sentinel a shell-claimed mutation rejects with. Same family as
 * `cancelled` — control flow, never part of a recoverable union — but
 * distinguishable, because "you cancelled" and "an enclosing shell owns this
 * outcome" are different events. Carries the claimed tag and the owning
 * shell's name for diagnostics; never the error value itself.
 */
export declare const claimed: (info: {
    readonly tag: string;
    readonly owner: string;
}) => Readonly<{
    _tag: "control/claimed";
    data: Readonly<{
        tag: string;
        owner: string;
    }>;
}>;
export type ClaimedSignal = ReturnType<typeof claimed>;
export declare const isClaimed: (value: unknown) => value is ClaimedSignal;
export interface TransportResponse {
    readonly status: number;
    readonly contentType: string | null;
    readonly body: string;
    /** Server contract stamp. `null` is a protocol failure, never compatibility mode. */
    readonly contract: string | null;
}
export interface TransportStreamResponse {
    readonly status: number;
    readonly contentType: string | null;
    readonly body: ReadableStream<Uint8Array> | null;
    /** Stream handshake metadata. `null` means the server supplied no contract stamp. */
    readonly contract: string | null;
}
export type TransportOutcome = Readonly<{
    ok: true;
    response: TransportResponse;
}> | Readonly<{
    ok: false;
    reason: "offline";
}> | Readonly<{
    ok: false;
    reason: "network";
}> | Readonly<{
    ok: false;
    reason: "timeout";
    timeoutMs: number;
}>;
export type TransportStreamOutcome = Readonly<{
    ok: true;
    response: TransportStreamResponse;
}> | Exclude<TransportOutcome, {
    ok: true;
}>;
export interface TransportRequestOptions {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    /** Direct-client operation retry. Query/subscription runtimes leave this unset. */
    readonly retry?: false | "from-error-policy";
    /**
     * Resume point for a `.resumable()` subscription. The subscription runtime
     * sets this on reconnect; a direct caller may set it to resume a stream it
     * was tracking itself.
     */
    readonly lastEventId?: string;
}
export interface ClientTransport {
    request(envelope: RequestEnvelope, options?: TransportRequestOptions): Promise<TransportOutcome>;
    stream?(envelope: RequestEnvelope, options?: TransportRequestOptions): Promise<TransportStreamOutcome>;
}
export interface FetchTransportOptions {
    readonly url: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly timeoutMs?: number;
    readonly maxResponseBytes?: number;
    readonly headers?: Readonly<Record<string, string>>;
}
export interface BatchFetchTransportOptions extends FetchTransportOptions {
    readonly maxItems?: number;
}
export declare const fetchTransport: (options: FetchTransportOptions) => ClientTransport;
/** Coalesces calls made in the same microtask into one HTTP request. */
export declare const batchFetchTransport: (options: BatchFetchTransportOptions) => ClientTransport;
export declare const requestEnvelope: (path: string, input: RequestEnvelope["input"], lastEventId?: string) => RequestEnvelope;

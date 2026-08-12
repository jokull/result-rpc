import type { EncodedTaggedError } from "./error.js";
import { type WireValue } from "./wire.js";
export declare const PROTOCOL_VERSION = 1;
export declare const PROTOCOL_CONTENT_TYPE = "application/result-rpc+devalue; sv=1";
export declare const STREAM_CONTENT_TYPE = "application/result-rpc-stream+devalue; sv=1";
/** Response header carrying the server's contract digest, for skew detection. */
export declare const CONTRACT_HEADER = "x-result-rpc-contract";
export declare const isProtocolContentType: (value: string | null) => boolean;
export declare const isStreamContentType: (value: string | null) => boolean;
export interface RequestEnvelope {
    readonly v: typeof PROTOCOL_VERSION;
    readonly path: string;
    readonly input: WireValue;
    /**
     * Resume point for a subscription that declared `.resumable()`: the event id
     * of the last event this client observed. Rides beside the input rather than
     * inside it so the procedure's input codec — and therefore the contract
     * digest — is unchanged by resumability.
     */
    readonly lastEventId?: string;
}
export interface BatchRequestItem extends RequestEnvelope {
    readonly id: string;
}
export interface BatchRequestEnvelope {
    readonly v: typeof PROTOCOL_VERSION;
    readonly batch: readonly BatchRequestItem[];
}
export interface SuccessEnvelope {
    readonly v: typeof PROTOCOL_VERSION;
    readonly status: "ok";
    readonly value: WireValue;
    /** Entity keys (`model:id`) the handler declared touching — identities only, never values. */
    readonly touched?: readonly string[];
}
export interface FailureEnvelope {
    readonly v: typeof PROTOCOL_VERSION;
    readonly status: "error";
    readonly error: EncodedTaggedError;
    /** Entity keys (`model:id`) the handler declared touching — identities only, never values. */
    readonly touched?: readonly string[];
}
export type ResponseEnvelope = SuccessEnvelope | FailureEnvelope;
export interface BatchResponseItem {
    readonly id: string;
    readonly status: number;
    readonly response: ResponseEnvelope;
}
export interface BatchResponseEnvelope {
    readonly v: typeof PROTOCOL_VERSION;
    readonly batch: readonly BatchResponseItem[];
}
export type StreamFrame = Readonly<{
    v: typeof PROTOCOL_VERSION;
    seq: number;
    done: false;
    response: ResponseEnvelope;
}> | Readonly<{
    v: typeof PROTOCOL_VERSION;
    seq: number;
    done: true;
}>;
export declare const decodeRequestEnvelope: (value: unknown) => RequestEnvelope | undefined;
export declare const decodeBatchRequestEnvelope: (value: unknown) => BatchRequestEnvelope | undefined;
export declare const decodeResponseEnvelope: (value: unknown) => ResponseEnvelope | undefined;
export declare const decodeBatchResponseEnvelope: (value: unknown) => BatchResponseEnvelope | undefined;
export declare const decodeStreamFrame: (value: unknown) => StreamFrame | undefined;

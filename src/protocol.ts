import type { EncodedTaggedError } from "./error.js";
import { isWireValue, type WireValue } from "./wire.js";

export const PROTOCOL_VERSION = 2;
export const PROTOCOL_CONTENT_TYPE = "application/result-rpc+devalue; sv=2";
export const STREAM_CONTENT_TYPE = "application/result-rpc-stream+devalue; sv=2";
/** Response header carrying the server's contract digest, for skew detection. */
export const CONTRACT_HEADER = "x-result-rpc-contract";

const matchesContentType = (value: string | null, mediaType: string): boolean => {
  if (value === null) return false;
  const [type, ...parameters] = value
    .toLowerCase()
    .split(";")
    .map((part) => part.trim());
  const serializerVersions = parameters.filter((parameter) => parameter.startsWith("sv="));
  return type === mediaType && serializerVersions.length === 1 && serializerVersions[0] === "sv=2";
};

export const isProtocolContentType = (value: string | null): boolean =>
  matchesContentType(value, "application/result-rpc+devalue");

export const isStreamContentType = (value: string | null): boolean =>
  matchesContentType(value, "application/result-rpc-stream+devalue");

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

export type StreamFrame =
  | Readonly<{ v: typeof PROTOCOL_VERSION; seq: number; done: false; response: ResponseEnvelope }>
  | Readonly<{ v: typeof PROTOCOL_VERSION; seq: number; done: true }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const touchedOf = (value: Record<string, unknown>): readonly string[] | undefined | false => {
  if (!("touched" in value)) return undefined;
  return Array.isArray(value.touched) && value.touched.every((entry) => typeof entry === "string")
    ? value.touched
    : false;
};

export const decodeRequestEnvelope = (value: unknown): RequestEnvelope | undefined => {
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || typeof value.path !== "string") {
    return undefined;
  }
  if (!("input" in value) || !isWireValue(value.input)) return undefined;
  // Absent is the norm (every unary call, and a subscription's first connect);
  // a non-string here is a malformed envelope, not a missing resume point.
  if ("lastEventId" in value && typeof value.lastEventId !== "string") return undefined;
  return {
    v: PROTOCOL_VERSION,
    path: value.path,
    input: value.input,
    ...(typeof value.lastEventId === "string" ? { lastEventId: value.lastEventId } : {}),
  };
};

export const decodeBatchRequestEnvelope = (value: unknown): BatchRequestEnvelope | undefined => {
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || !Array.isArray(value.batch)) {
    return undefined;
  }
  const batch: BatchRequestItem[] = [];
  for (const item of value.batch) {
    const envelope = decodeRequestEnvelope(item);
    if (!envelope || !isRecord(item) || typeof item.id !== "string") return undefined;
    batch.push({ ...envelope, id: item.id });
  }
  return { v: PROTOCOL_VERSION, batch };
};

export const decodeResponseEnvelope = (value: unknown): ResponseEnvelope | undefined => {
  if (
    !isRecord(value) ||
    value.v !== PROTOCOL_VERSION ||
    typeof value.status !== "string" ||
    (value.status !== "ok" && value.status !== "error")
  ) {
    return undefined;
  }
  const touched = touchedOf(value);
  if (touched === false) return undefined;
  if (value.status === "ok" && "value" in value && isWireValue(value.value)) {
    return {
      v: PROTOCOL_VERSION,
      status: "ok",
      value: value.value,
      ...(touched === undefined ? {} : { touched }),
    };
  }
  if (
    value.status === "error" &&
    isRecord(value.error) &&
    typeof value.error._tag === "string" &&
    "data" in value.error &&
    isWireValue(value.error.data)
  ) {
    return {
      v: PROTOCOL_VERSION,
      status: "error",
      error: { _tag: value.error._tag, data: value.error.data },
      ...(touched === undefined ? {} : { touched }),
    };
  }
  return undefined;
};

export const decodeBatchResponseEnvelope = (value: unknown): BatchResponseEnvelope | undefined => {
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || !Array.isArray(value.batch)) {
    return undefined;
  }
  const batch: BatchResponseItem[] = [];
  for (const item of value.batch) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.status !== "number") {
      return undefined;
    }
    const response = decodeResponseEnvelope(item.response);
    if (!response) return undefined;
    batch.push({ id: item.id, status: item.status, response });
  }
  return { v: PROTOCOL_VERSION, batch };
};

export const decodeStreamFrame = (value: unknown): StreamFrame | undefined => {
  if (
    !isRecord(value) ||
    value.v !== PROTOCOL_VERSION ||
    typeof value.seq !== "number" ||
    !Number.isSafeInteger(value.seq) ||
    typeof value.done !== "boolean"
  )
    return undefined;
  if (value.done) return { v: PROTOCOL_VERSION, seq: value.seq, done: true };
  const response = decodeResponseEnvelope(value.response);
  return response === undefined
    ? undefined
    : { v: PROTOCOL_VERSION, seq: value.seq, done: false, response };
};

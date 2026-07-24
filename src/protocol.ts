import type { AnyTaggedError } from "./error.js";
import type { WireValue } from "./wire.js";

export const PROTOCOL_VERSION = 1 as const;
export const PROTOCOL_CONTENT_TYPE = "application/result-rpc+devalue; sv=1";
export const STREAM_CONTENT_TYPE = "application/result-rpc-stream+devalue; sv=1";
/** Response header carrying the server's contract digest, for skew detection. */
export const CONTRACT_HEADER = "x-result-rpc-contract";

const matchesContentType = (value: string | null, mediaType: string): boolean => {
  if (value === null) return false;
  const [type, ...parameters] = value.toLowerCase().split(";").map((part) => part.trim());
  const serializerVersions = parameters.filter((parameter) => parameter.startsWith("sv="));
  return type === mediaType
    && serializerVersions.length === 1
    && serializerVersions[0] === "sv=1";
};

export const isProtocolContentType = (value: string | null): boolean =>
  matchesContentType(value, "application/result-rpc+devalue");

export const isStreamContentType = (value: string | null): boolean =>
  matchesContentType(value, "application/result-rpc-stream+devalue");

export interface RequestEnvelope {
  readonly v: typeof PROTOCOL_VERSION;
  readonly path: string;
  readonly input: WireValue;
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
  readonly ok: true;
  readonly value: WireValue;
  /** Entity keys (`model:id`) the handler declared touching — identities only, never values. */
  readonly touched?: readonly string[];
}

export interface FailureEnvelope {
  readonly v: typeof PROTOCOL_VERSION;
  readonly ok: false;
  readonly error: AnyTaggedError;
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

export const decodeRequestEnvelope = (value: unknown): RequestEnvelope | undefined => {
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || typeof value.path !== "string") {
    return undefined;
  }
  if (!("input" in value)) return undefined;
  return value as unknown as RequestEnvelope;
};

export const decodeBatchRequestEnvelope = (
  value: unknown,
): BatchRequestEnvelope | undefined => {
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
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || typeof value.ok !== "boolean") {
    return undefined;
  }
  if (value.ok === true && "value" in value) return value as unknown as SuccessEnvelope;
  if (
    value.ok === false
    && isRecord(value.error)
    && typeof value.error._tag === "string"
    && "data" in value.error
  ) {
    return value as unknown as FailureEnvelope;
  }
  return undefined;
};

export const decodeBatchResponseEnvelope = (
  value: unknown,
): BatchResponseEnvelope | undefined => {
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
    !isRecord(value)
    || value.v !== PROTOCOL_VERSION
    || !Number.isSafeInteger(value.seq)
    || typeof value.done !== "boolean"
  ) return undefined;
  if (value.done) return { v: PROTOCOL_VERSION, seq: value.seq as number, done: true };
  const response = decodeResponseEnvelope(value.response);
  return response === undefined
    ? undefined
    : { v: PROTOCOL_VERSION, seq: value.seq as number, done: false, response };
};

import { parse, stringify } from "devalue";

export const SERIALIZER_NAME = "devalue" as const;
export const SERIALIZER_VERSION = 1 as const;
export const DEFAULT_MAX_WIRE_BYTES = 1_048_576;
export const DEFAULT_MAX_ERROR_BYTES = 65_536;

export interface SerializationOptions {
  readonly maxBytes?: number;
}

export type SerializationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; path?: string; message: string }>;

const encodedBytes = (value: string): number => new TextEncoder().encode(value).byteLength;

export const serialize = (
  value: unknown,
  options: SerializationOptions = {},
): SerializationResult<string> => {
  try {
    const serialized = stringify(value);
    if (options.maxBytes !== undefined && encodedBytes(serialized) > options.maxBytes) {
      return { ok: false, message: `Encoded value exceeds ${options.maxBytes} bytes` };
    }
    return { ok: true, value: serialized };
  } catch (cause) {
    const path = cause !== null
      && typeof cause === "object"
      && "path" in cause
      && typeof cause.path === "string"
      ? cause.path
      : undefined;
    return {
      ok: false,
      ...(path === undefined ? {} : { path }),
      message: cause instanceof Error ? cause.message : "Value is not serializable",
    };
  }
};

export const deserialize = (
  value: string,
  options: SerializationOptions = {},
): SerializationResult<unknown> => {
  try {
    if (options.maxBytes !== undefined && encodedBytes(value) > options.maxBytes) {
      return { ok: false, message: `Encoded value exceeds ${options.maxBytes} bytes` };
    }
    return { ok: true, value: parse(value) as unknown };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Value could not be deserialized",
    };
  }
};

export const isSerializable = (value: unknown): boolean => serialize(value).ok;

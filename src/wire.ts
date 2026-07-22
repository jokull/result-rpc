import { isSerializable } from "./serializer.js";

export type WireScalar = undefined | null | boolean | string | number | bigint;

export type WireTypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array
  | DataView;

export type WireValue =
  | WireScalar
  | Date
  | RegExp
  | URL
  | URLSearchParams
  | ArrayBuffer
  | WireTypedArray
  | readonly WireValue[]
  | ReadonlyMap<WireValue, WireValue>
  | ReadonlySet<WireValue>
  | { readonly [key: string]: WireValue };

export interface CodecIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type DecodeResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; issues: readonly CodecIssue[] }>;

export interface WireCodec<Input, Encoded extends WireValue = WireValue> {
  readonly kind: string;
  encode(input: Input): DecodeResult<Encoded>;
  decode(value: unknown): DecodeResult<Input>;
}

export type InputOf<TCodec> = TCodec extends WireCodec<infer TInput, WireValue>
  ? TInput
  : never;

export type EncodedOf<TCodec> = TCodec extends WireCodec<unknown, infer TEncoded>
  ? TEncoded
  : never;

const success = <T>(value: T): DecodeResult<T> => ({ ok: true, value });

const failure = (
  message: string,
  path: readonly (string | number)[] = [],
): DecodeResult<never> => ({ ok: false, issues: [{ path, message }] });

const atPath = (
  issue: CodecIssue,
  segment: string | number,
): CodecIssue => ({ ...issue, path: [segment, ...issue.path] });

const stringCodec: WireCodec<string, string> = {
  kind: "string",
  encode: (input) =>
    typeof input === "string" ? success(input) : failure("Expected a string"),
  decode: (value) =>
    typeof value === "string" ? success(value) : failure("Expected a string"),
};

const booleanCodec: WireCodec<boolean, boolean> = {
  kind: "boolean",
  encode: (input) =>
    typeof input === "boolean" ? success(input) : failure("Expected a boolean"),
  decode: (value) =>
    typeof value === "boolean" ? success(value) : failure("Expected a boolean"),
};

const numberCodec: WireCodec<number, number> = {
  kind: "number",
  encode: (input) => typeof input === "number" ? success(input) : failure("Expected a number"),
  decode: (value) =>
    typeof value === "number" ? success(value) : failure("Expected a number"),
};

const finiteNumberCodec: WireCodec<number, number> = {
  kind: "finite-number",
  encode: (input) => Number.isFinite(input) ? success(input) : failure("Expected a finite number"),
  decode: (value) => typeof value === "number" && Number.isFinite(value)
    ? success(value)
    : failure("Expected a finite number"),
};

const bigintCodec: WireCodec<bigint, bigint> = {
  kind: "bigint",
  encode: (input) => typeof input === "bigint" ? success(input) : failure("Expected a bigint"),
  decode: (value) => typeof value === "bigint" ? success(value) : failure("Expected a bigint"),
};

const undefinedCodec: WireCodec<undefined, undefined> = {
  kind: "undefined",
  encode: (input) => input === undefined ? success(undefined) : failure("Expected undefined"),
  decode: (value) => value === undefined ? success(undefined) : failure("Expected undefined"),
};

const dateCodec: WireCodec<Date, Date> = {
  kind: "date",
  encode: (input) => input instanceof Date && !Number.isNaN(input.getTime())
    ? success(new Date(input))
    : failure("Expected a valid Date"),
  decode: (value) => value instanceof Date && !Number.isNaN(value.getTime())
    ? success(new Date(value))
    : failure("Expected a valid Date"),
};

const regexpCodec: WireCodec<RegExp, RegExp> = {
  kind: "regexp",
  encode: (input) => input instanceof RegExp
    ? success(new RegExp(input.source, input.flags))
    : failure("Expected a RegExp"),
  decode: (value) => value instanceof RegExp
    ? success(new RegExp(value.source, value.flags))
    : failure("Expected a RegExp"),
};

const urlCodec: WireCodec<URL, URL> = {
  kind: "url",
  encode: (input) => input instanceof URL ? success(new URL(input)) : failure("Expected a URL"),
  decode: (value) => value instanceof URL ? success(new URL(value)) : failure("Expected a URL"),
};

const serializable = <T>(): WireCodec<T, T & WireValue> => ({
  kind: "serializable",
  encode: (input) => isSerializable(input)
    ? success(input as T & WireValue)
    : failure("Expected a value supported by the wire serializer"),
  decode: (value) => isSerializable(value)
    ? success(value as T)
    : failure("Expected a value supported by the wire serializer"),
});

const nullCodec: WireCodec<null, null> = {
  kind: "null",
  encode: (input) => (input === null ? success(null) : failure("Expected null")),
  decode: (value) => (value === null ? success(null) : failure("Expected null")),
};

export interface IntegerOptions {
  readonly min?: number;
  readonly max?: number;
}

const integer = (options: IntegerOptions = {}): WireCodec<number, number> => ({
  kind: "integer",
  encode: (input) => validateInteger(input, options),
  decode: (value) => validateInteger(value, options),
});

const validateInteger = (
  value: unknown,
  options: IntegerOptions,
): DecodeResult<number> => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return failure("Expected a safe integer");
  }
  if (options.min !== undefined && value < options.min) {
    return failure(`Expected an integer greater than or equal to ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    return failure(`Expected an integer less than or equal to ${options.max}`);
  }
  return success(value);
};

const literal = <const TValue extends WireScalar>(
  expected: TValue,
): WireCodec<TValue, TValue> => ({
  kind: "literal",
  encode: (input) =>
    Object.is(input, expected) ? success(input) : failure(`Expected ${String(expected)}`),
  decode: (value) =>
    Object.is(value, expected) ? success(expected) : failure(`Expected ${String(expected)}`),
});

const array = <TInput, TEncoded extends WireValue>(
  item: WireCodec<TInput, TEncoded>,
): WireCodec<readonly TInput[], readonly TEncoded[]> => ({
  kind: "array",
  encode: (input) => {
    if (!Array.isArray(input)) return failure("Expected an array");
    const output: TEncoded[] = [];
    const issues: CodecIssue[] = [];
    input.forEach((value, index) => {
      const result = item.encode(value);
      if (result.ok) output.push(result.value);
      else issues.push(...result.issues.map((issue) => atPath(issue, index)));
    });
    return issues.length > 0 ? { ok: false, issues } : success(output);
  },
  decode: (value) => {
    if (!Array.isArray(value)) return failure("Expected an array");
    const output: TInput[] = [];
    const issues: CodecIssue[] = [];
    value.forEach((entry, index) => {
      const result = item.decode(entry);
      if (result.ok) output.push(result.value);
      else issues.push(...result.issues.map((issue) => atPath(issue, index)));
    });
    return issues.length > 0 ? { ok: false, issues } : success(output);
  },
});

type CodecInputUnion<TCodecs extends readonly WireCodec<unknown, WireValue>[]> =
  InputOf<TCodecs[number]>;

type CodecEncodedUnion<TCodecs extends readonly WireCodec<unknown, WireValue>[]> =
  EncodedOf<TCodecs[number]>;

const union = <const TCodecs extends readonly WireCodec<unknown, WireValue>[]>(
  codecs: TCodecs,
): WireCodec<CodecInputUnion<TCodecs>, CodecEncodedUnion<TCodecs>> => ({
  kind: "union",
  encode: (input) => {
    for (const codec of codecs) {
      const result = codec.encode(input);
      if (result.ok) return result as DecodeResult<CodecEncodedUnion<TCodecs>>;
    }
    return failure("Value did not match any union member");
  },
  decode: (value) => {
    for (const codec of codecs) {
      const result = codec.decode(value);
      if (result.ok) return result as DecodeResult<CodecInputUnion<TCodecs>>;
    }
    return failure("Value did not match any union member");
  },
});

type CodecShape = Readonly<Record<string, WireCodec<unknown, WireValue>>>;

interface OptionalWireCodec<TInput, TEncoded extends WireValue>
  extends WireCodec<TInput | undefined, TEncoded | undefined> {
  readonly optional: true;
}

type OptionalShapeKeys<TShape extends CodecShape> = {
  [TKey in keyof TShape]: TShape[TKey] extends { readonly optional: true } ? TKey : never;
}[keyof TShape];
type RequiredShapeKeys<TShape extends CodecShape> = Exclude<keyof TShape, OptionalShapeKeys<TShape>>;

type ShapeInput<TShape extends CodecShape> =
  & { readonly [TKey in RequiredShapeKeys<TShape>]: InputOf<TShape[TKey]> }
  & { readonly [TKey in OptionalShapeKeys<TShape>]?: Exclude<InputOf<TShape[TKey]>, undefined> };

type ShapeEncoded<TShape extends CodecShape> =
  & { readonly [TKey in RequiredShapeKeys<TShape>]: EncodedOf<TShape[TKey]> }
  & { readonly [TKey in OptionalShapeKeys<TShape>]?: Exclude<EncodedOf<TShape[TKey]>, undefined> };

const optional = <TInput, TEncoded extends WireValue>(
  codec: WireCodec<TInput, TEncoded>,
): OptionalWireCodec<TInput, TEncoded> => ({
  kind: `optional(${codec.kind})`,
  optional: true,
  encode: (input) => input === undefined ? success(undefined) : codec.encode(input),
  decode: (value) => value === undefined ? success(undefined) : codec.decode(value),
});

const record = <TInput, TEncoded extends WireValue>(
  codec: WireCodec<TInput, TEncoded>,
): WireCodec<Readonly<Record<string, TInput>>, Readonly<Record<string, TEncoded>>> => ({
  kind: `record(${codec.kind})`,
  encode: (input) => processRecord(input, codec, "encode"),
  decode: (value) => processRecord(value, codec, "decode"),
});

const processRecord = <TInput, TEncoded extends WireValue>(
  value: unknown,
  codec: WireCodec<TInput, TEncoded>,
  direction: "encode" | "decode",
): DecodeResult<Record<string, any>> => {
  if (!isPlainObject(value)) return failure("Expected a plain object record");
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const issues: CodecIssue[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const result = direction === "encode" ? codec.encode(entry as TInput) : codec.decode(entry);
    if (result.ok) {
      Object.defineProperty(output, key, {
        value: result.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else issues.push(...result.issues.map((issue) => atPath(issue, key)));
  }
  return issues.length > 0 ? { ok: false, issues } : success(output);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

const object = <const TShape extends CodecShape>(
  shape: TShape,
): WireCodec<ShapeInput<TShape>, ShapeEncoded<TShape>> => ({
  kind: "object",
  encode: (input) => {
    const result = processObject(input, shape, "encode");
    // SAFETY: encode invokes every shape codec's encode method, so the mapped
    // output is ShapeEncoded<TShape> when there are no issues.
    return result as DecodeResult<ShapeEncoded<TShape>>;
  },
  decode: (value) => {
    const result = processObject(value, shape, "decode");
    // SAFETY: decode invokes every shape codec's decode method, so the mapped
    // output is ShapeInput<TShape> when there are no issues.
    return result as DecodeResult<ShapeInput<TShape>>;
  },
});

const processObject = <const TShape extends CodecShape>(
  value: unknown,
  shape: TShape,
  direction: "encode" | "decode",
): DecodeResult<Record<string, unknown>> => {
  if (!isPlainObject(value)) return failure("Expected a plain object");

  const allowedKeys = new Set(Object.keys(shape));
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      issues: unknownKeys.map((key) => ({ path: [key], message: "Unknown property" })),
    };
  }

  const output: Record<string, unknown> = {};
  const issues: CodecIssue[] = [];
  for (const [key, codec] of Object.entries(shape)) {
    if (!(key in value) && "optional" in codec && codec.optional === true) continue;
    const result = direction === "encode"
      ? codec.encode(value[key])
      : codec.decode(value[key]);
    if (result.ok) {
      Object.defineProperty(output, key, {
        value: result.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else issues.push(...result.issues.map((issue) => atPath(issue, key)));
  }

  return issues.length > 0 ? { ok: false, issues } : success(output);
};

export const wire = {
  string: stringCodec,
  boolean: booleanCodec,
  number: numberCodec,
  finiteNumber: finiteNumberCodec,
  bigint: bigintCodec,
  undefined: undefinedCodec,
  date: dateCodec,
  regexp: regexpCodec,
  url: urlCodec,
  null: nullCodec,
  integer,
  literal,
  array,
  union,
  optional,
  record,
  object,
  serializable,
} as const;

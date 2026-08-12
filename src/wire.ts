import type { StandardSchemaResult, StandardSchemaV1 } from "./standard-schema.js";
import { Temporal } from "temporal-polyfill";

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
  | Temporal.PlainDate
  | Temporal.PlainDateTime
  | Temporal.PlainTime
  | Temporal.PlainYearMonth
  | Temporal.PlainMonthDay
  | Temporal.Instant
  | Temporal.ZonedDateTime
  | Temporal.Duration
  | RegExp
  | URL
  | URLSearchParams
  | ArrayBuffer
  | WireTypedArray
  | readonly WireValue[]
  | ReadonlyMap<WireValue, WireValue>
  | ReadonlySet<WireValue>
  | { readonly [key: string]: WireValue };

/** Runtime counterpart of {@link WireValue}, used at untrusted wire boundaries. */
export const isWireValue = (value: unknown, seen = new WeakSet<object>()): value is WireValue => {
  if (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return true;
  }
  if (typeof value !== "object") return false;
  if (
    value instanceof Date ||
    value instanceof Temporal.PlainDate ||
    value instanceof Temporal.PlainDateTime ||
    value instanceof Temporal.PlainTime ||
    value instanceof Temporal.PlainYearMonth ||
    value instanceof Temporal.PlainMonthDay ||
    value instanceof Temporal.Instant ||
    value instanceof Temporal.ZonedDateTime ||
    value instanceof Temporal.Duration ||
    value instanceof RegExp ||
    value instanceof URL ||
    value instanceof URLSearchParams ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return true;
  }
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.every((entry) => isWireValue(entry, seen));
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      if (!isWireValue(key, seen) || !isWireValue(entry, seen)) return false;
    }
    return true;
  }
  if (value instanceof Set) {
    for (const entry of value) {
      if (!isWireValue(entry, seen)) return false;
    }
    return true;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every((entry) => isWireValue(entry, seen));
};

export interface CodecIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type DecodeResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; issues: readonly CodecIssue[] }>;

export interface WireCodec<Input, Encoded extends WireValue = WireValue> {
  /** Human-readable codec family used in diagnostics. */
  readonly kind: string;
  /** Canonical structural identity used by contract-version computation. */
  readonly schema: string;
  readonly encode: (input: Input) => DecodeResult<Encoded>;
  readonly decode: (value: unknown) => DecodeResult<Input>;
}

/**
 * A true runtime-registry existential. Every concrete WireCodec is assignable
 * to it, but erased consumers cannot feed `unknown` back into its encoder.
 * Use the audited dynamic helper below only at an already-erased wire boundary.
 */
export interface AnyWireCodec {
  readonly kind: string;
  readonly schema: string;
  readonly encode: (input: never) => DecodeResult<WireValue>;
  readonly decode: (value: unknown) => DecodeResult<unknown>;
}

/** @internal Dynamic encode after a runtime registry has intentionally erased Input. */
export const encodeUnknownWireValue = (
  codec: AnyWireCodec,
  input: unknown,
): DecodeResult<WireValue> => codec.encode(input as never);

/** An object with no string properties; unlike `{}`, primitives do not satisfy it. */
export type EmptyObject = Readonly<Record<string, never>>;

/**
 * Preserve an explicit `undefined` when a codec accepts it. When it does not,
 * treat `undefined` as the conventional options placeholder for a zero-input
 * procedure and try the default empty-object input.
 */
export function encodeProcedureInput<TInput, TEncoded extends WireValue>(
  codec: WireCodec<TInput, TEncoded>,
  input: TInput,
): DecodeResult<TEncoded>;
export function encodeProcedureInput(codec: AnyWireCodec, input: unknown): DecodeResult<WireValue>;
export function encodeProcedureInput(codec: AnyWireCodec, input: unknown): DecodeResult<WireValue> {
  const encoded = encodeUnknownWireValue(codec, input);
  return !encoded.ok && input === undefined ? encodeUnknownWireValue(codec, {}) : encoded;
}

export type InputOf<TCodec> =
  TCodec extends WireCodec<infer TInput, infer _TEncoded> ? TInput : never;

export type EncodedOf<TCodec> =
  TCodec extends WireCodec<infer _TInput, infer TEncoded> ? TEncoded : never;

export const success = <T>(value: T): DecodeResult<T> => ({ ok: true, value });

export const failure = (
  message: string,
  path: readonly (string | number)[] = [],
): DecodeResult<never> => ({ ok: false, issues: [{ path, message }] });

/** Canonical array encoding avoids delimiter and object-key-order ambiguity. */
const schemaOf = (...parts: readonly unknown[]): string => JSON.stringify(parts);

const scalarSchema = (value: WireScalar): string => {
  if (value === undefined) return schemaOf("undefined");
  if (typeof value === "bigint") return schemaOf("bigint", value.toString());
  if (typeof value === "number") {
    if (Number.isNaN(value)) return schemaOf("number", "nan");
    if (value === Infinity) return schemaOf("number", "+infinity");
    if (value === -Infinity) return schemaOf("number", "-infinity");
    if (Object.is(value, -0)) return schemaOf("number", "-0");
  }
  return schemaOf(typeof value, value);
};

const atPath = (issue: CodecIssue, segment: string | number): CodecIssue => ({
  ...issue,
  path: [segment, ...issue.path],
});

const stringCodec: WireCodec<string, string> = {
  kind: "string",
  schema: schemaOf("string"),
  encode: (input) => (typeof input === "string" ? success(input) : failure("Expected a string")),
  decode: (value) => (typeof value === "string" ? success(value) : failure("Expected a string")),
};

const booleanCodec: WireCodec<boolean, boolean> = {
  kind: "boolean",
  schema: schemaOf("boolean"),
  encode: (input) => (typeof input === "boolean" ? success(input) : failure("Expected a boolean")),
  decode: (value) => (typeof value === "boolean" ? success(value) : failure("Expected a boolean")),
};

const numberCodec: WireCodec<number, number> = {
  kind: "number",
  schema: schemaOf("number"),
  encode: (input) => (typeof input === "number" ? success(input) : failure("Expected a number")),
  decode: (value) => (typeof value === "number" ? success(value) : failure("Expected a number")),
};

const finiteNumberCodec: WireCodec<number, number> = {
  kind: "finite-number",
  schema: schemaOf("finite-number"),
  encode: (input) =>
    Number.isFinite(input) ? success(input) : failure("Expected a finite number"),
  decode: (value) =>
    typeof value === "number" && Number.isFinite(value)
      ? success(value)
      : failure("Expected a finite number"),
};

const bigintCodec: WireCodec<bigint, bigint> = {
  kind: "bigint",
  schema: schemaOf("bigint"),
  encode: (input) => (typeof input === "bigint" ? success(input) : failure("Expected a bigint")),
  decode: (value) => (typeof value === "bigint" ? success(value) : failure("Expected a bigint")),
};

const undefinedCodec: WireCodec<undefined, undefined> = {
  kind: "undefined",
  schema: schemaOf("undefined"),
  encode: (input) => (input === undefined ? success(undefined) : failure("Expected undefined")),
  decode: (value) => (value === undefined ? success(undefined) : failure("Expected undefined")),
};

const dateCodec: WireCodec<Date, Date> = {
  kind: "date",
  schema: schemaOf("date"),
  encode: (input) =>
    input instanceof Date && !Number.isNaN(input.getTime())
      ? success(new Date(input))
      : failure("Expected a valid Date"),
  decode: (value) =>
    value instanceof Date && !Number.isNaN(value.getTime())
      ? success(new Date(value))
      : failure("Expected a valid Date"),
};

const regexpCodec: WireCodec<RegExp, RegExp> = {
  kind: "regexp",
  schema: schemaOf("regexp"),
  encode: (input) =>
    input instanceof RegExp
      ? success(new RegExp(input.source, input.flags))
      : failure("Expected a RegExp"),
  decode: (value) =>
    value instanceof RegExp
      ? success(new RegExp(value.source, value.flags))
      : failure("Expected a RegExp"),
};

const urlCodec: WireCodec<URL, URL> = {
  kind: "url",
  schema: schemaOf("url"),
  encode: (input) => (input instanceof URL ? success(new URL(input)) : failure("Expected a URL")),
  decode: (value) => (value instanceof URL ? success(new URL(value)) : failure("Expected a URL")),
};

type StandardOutput<TSchema extends StandardSchemaV1<unknown, unknown>> =
  TSchema extends StandardSchemaV1<unknown, infer TOutput> ? TOutput : never;

const toPathKey = (key: PropertyKey): string | number =>
  typeof key === "number" ? key : String(key);

const isTypedWireValue = <T>(value: T): value is T & WireValue => isWireValue(value);

export interface ExternalWireSchemaOptions {
  /** Stable application-owned identity; change it whenever accepted data changes. */
  readonly id: string;
}

const externalSchemaId = (kind: string, options: ExternalWireSchemaOptions): string => {
  if (options.id.trim().length === 0) throw new TypeError(`${kind} schema id must not be empty`);
  return options.id;
};

/**
 * Adopts a Standard Schema (Valibot, Zod, ArkType, ...) as a wire input
 * codec — for teams whose validator is their input vocabulary (the tRPC
 * `.input(z.object(...))` habit). Validation runs on both sides of the wire,
 * and the validated value must also survive the wire serializer.
 *
 * Constraints: async schemas are rejected (wire validation is synchronous),
 * and the schema must accept its own output — one-way transforms break the
 * encode/decode symmetry. This adopts a validator for the WIRE; it does not
 * make the input codec a form schema — forms validate humans, wires validate
 * applications.
 *
 * `options.id` is part of the RPC contract fingerprint. Standard Schema does
 * not expose a portable structural description, so the application owns this
 * stable identifier and must change it whenever the accepted wire shape or
 * semantics change.
 */
const standard = <TSchema extends StandardSchemaV1<unknown, unknown>>(
  schema: TSchema,
  options: ExternalWireSchemaOptions,
): WireCodec<StandardOutput<TSchema>, WireValue> => {
  const validate = (value: unknown): DecodeResult<StandardOutput<TSchema> & WireValue> => {
    let result:
      | StandardSchemaResult<StandardOutput<TSchema>>
      | Promise<StandardSchemaResult<StandardOutput<TSchema>>>;
    try {
      // Standard Schema's optional `types` carrier and validate method are
      // specified to agree; this is the one adoption boundary for that fact.
      result = schema["~standard"].validate(value) as typeof result;
    } catch {
      return failure("Schema validation failed");
    }
    if (result instanceof Promise) {
      return failure("Async schemas are not supported on the wire");
    }
    if (result.issues) {
      return {
        ok: false,
        issues: result.issues.map((issue) => ({
          path: (issue.path ?? []).map((segment) =>
            typeof segment === "object" && segment !== null && "key" in segment
              ? toPathKey(segment.key)
              : toPathKey(segment),
          ),
          message: issue.message,
        })),
      };
    }
    if (!isTypedWireValue(result.value)) {
      return failure("Expected a value supported by the wire serializer");
    }
    return success(result.value);
  };
  return {
    kind: `standard(${schema["~standard"].vendor})`,
    schema: schemaOf(
      "standard",
      schema["~standard"].vendor,
      externalSchemaId("Standard Schema", options),
    ),
    encode: (input) => validate(input),
    decode: validate,
  };
};

export type WireGuard<T> = (value: unknown) => value is T;

/**
 * Adopts a guarded rich wire value. `options.id` is its stable contract schema
 * identity and must change whenever the guard's accepted shape changes.
 */
const serializable = <T>(
  guard: WireGuard<T>,
  options: ExternalWireSchemaOptions,
): WireCodec<T, T & WireValue> => ({
  kind: "serializable",
  schema: schemaOf("serializable", externalSchemaId("Serializable", options)),
  encode: (input) =>
    guard(input) && isWireValue(input)
      ? success(input)
      : failure("Expected a validated value supported by the wire serializer"),
  decode: (value) =>
    guard(value) && isWireValue(value)
      ? success(value)
      : failure("Expected a validated value supported by the wire serializer"),
});

export interface WireCodecOptions<TInput, TEncoded extends WireValue> {
  /**
   * Stable application-owned identity; part of the RPC contract fingerprint.
   * Change it whenever the accepted value or its wire encoding changes.
   */
  readonly id: string;
  /** The wire-side codec the encoded value must satisfy. */
  readonly wire: WireCodec<TEncoded, TEncoded>;
  /** Application value to wire value. May return a failure for out-of-range input. */
  readonly encode: (input: TInput) => DecodeResult<TEncoded>;
  /** Wire value back to application value. Receives only values `wire` accepts. */
  readonly decode: (value: unknown) => DecodeResult<TInput>;
}

/**
 * A transformation codec: the application value differs from the wire value.
 *
 * Built-ins cover values the wire serializer carries natively (Date, RegExp,
 * URL). `codec` is for everything else — a value that must travel as one of
 * its projections and be restored on the other side. The canonical example is
 * a calendar date: the domain speaks `Temporal.PlainDate`, the wire speaks
 * `"2026-08-07"`.
 *
 * ```ts
 * const plainDateCodec = wire.codec({
 *   id: "calendar-date/plain-date:v1",
 *   wire: wire.string,
 *   encode: (date: Temporal.PlainDate) => success(date.toString()),
 *   decode: (value) => success(Temporal.PlainDate.from(value)),
 * });
 * ```
 *
 * The factory composes through the declared `wire` codec on both sides: an
 * encoded value that fails the wire codec is rejected before it reaches the
 * serializer, and an incoming value the wire codec rejects never reaches the
 * custom decoder. The digest is `codec(<id>, <wire schema>)`, so the contract
 * fingerprint changes if either the identity or the wire shape changes.
 */
const codec = <TInput, TEncoded extends WireValue>(
  options: WireCodecOptions<TInput, TEncoded>,
): WireCodec<TInput, TEncoded> => ({
  kind: `codec(${options.wire.kind})`,
  schema: schemaOf("codec", externalSchemaId("codec", options), options.wire.schema),
  encode: (input) => {
    const encoded = options.encode(input);
    if (!encoded.ok) return encoded;
    return options.wire.encode(encoded.value);
  },
  decode: (value) => {
    const decoded = options.wire.decode(value);
    if (!decoded.ok) return decoded;
    return options.decode(decoded.value);
  },
});

/**
 * An identity codec for one of the eight calendar/clock-oriented Temporal
 * classes. Temporal values are native wire citizens, exactly like `Date`:
 * devalue carries them as their canonical ISO string and revives them with
 * `Temporal.X.from` (the serializer imports the polyfill's global entry, so
 * revival works on runtimes without native Temporal). `Temporal.TimeZone`
 * and `Temporal.Calendar` are identifier strings in the spec, so they travel
 * as plain `wire.string`.
 */
const temporalCodec = <T extends WireValue>(
  className: string,
  wireName: string,
  isInstance: (value: unknown) => value is T,
): WireCodec<T, T> => ({
  kind: `temporal/${wireName}`,
  schema: schemaOf(`temporal/${wireName}`),
  encode: (input) =>
    isInstance(input) ? success(input) : failure(`Expected a Temporal.${className} value`),
  decode: (value) =>
    isInstance(value) ? success(value) : failure(`Expected a Temporal.${className} value`),
});

const plainDateCodec = temporalCodec(
  "PlainDate",
  "plain-date",
  (value): value is Temporal.PlainDate => value instanceof Temporal.PlainDate,
);
const plainDateTimeCodec = temporalCodec(
  "PlainDateTime",
  "plain-date-time",
  (value): value is Temporal.PlainDateTime => value instanceof Temporal.PlainDateTime,
);
const plainTimeCodec = temporalCodec(
  "PlainTime",
  "plain-time",
  (value): value is Temporal.PlainTime => value instanceof Temporal.PlainTime,
);
const plainYearMonthCodec = temporalCodec(
  "PlainYearMonth",
  "plain-year-month",
  (value): value is Temporal.PlainYearMonth => value instanceof Temporal.PlainYearMonth,
);
const plainMonthDayCodec = temporalCodec(
  "PlainMonthDay",
  "plain-month-day",
  (value): value is Temporal.PlainMonthDay => value instanceof Temporal.PlainMonthDay,
);
const instantCodec = temporalCodec(
  "Instant",
  "instant",
  (value): value is Temporal.Instant => value instanceof Temporal.Instant,
);
const zonedDateTimeCodec = temporalCodec(
  "ZonedDateTime",
  "zoned-date-time",
  (value): value is Temporal.ZonedDateTime => value instanceof Temporal.ZonedDateTime,
);
const durationCodec = temporalCodec(
  "Duration",
  "duration",
  (value): value is Temporal.Duration => value instanceof Temporal.Duration,
);

const nullCodec: WireCodec<null, null> = {
  kind: "null",
  schema: schemaOf("null"),
  encode: (input) => (input === null ? success(null) : failure("Expected null")),
  decode: (value) => (value === null ? success(null) : failure("Expected null")),
};

export interface IntegerOptions {
  readonly min?: number;
  readonly max?: number;
}

const integer = (options: IntegerOptions = {}): WireCodec<number, number> => ({
  kind: "integer",
  schema: schemaOf("integer", options.min ?? null, options.max ?? null),
  encode: (input) => validateInteger(input, options),
  decode: (value) => validateInteger(value, options),
});

const validateInteger = (value: unknown, options: IntegerOptions): DecodeResult<number> => {
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

const literal = <const TValue extends WireScalar>(expected: TValue): WireCodec<TValue, TValue> => ({
  kind: "literal",
  schema: schemaOf("literal", scalarSchema(expected)),
  encode: (input) =>
    Object.is(input, expected) ? success(input) : failure(`Expected ${String(expected)}`),
  decode: (value) =>
    Object.is(value, expected) ? success(expected) : failure(`Expected ${String(expected)}`),
});

type NonEmptyStringTuple = readonly [string, ...string[]];

const isEnumValue = <const TValues extends NonEmptyStringTuple>(
  values: TValues,
  value: unknown,
): value is TValues[number] =>
  typeof value === "string" && values.some((candidate) => candidate === value);

/** A string literal union with the same contract identity as its expanded form. */
const enumCodec = <const TValues extends NonEmptyStringTuple>(
  values: TValues,
): WireCodec<TValues[number], TValues[number]> => ({
  kind: "union",
  schema: schemaOf(
    "union",
    values.map((value) => literal(value).schema),
  ),
  encode: (input) =>
    isEnumValue(values, input) ? success(input) : failure(`Expected one of: ${values.join(", ")}`),
  decode: (value) =>
    isEnumValue(values, value) ? success(value) : failure(`Expected one of: ${values.join(", ")}`),
});

const array = <TInput, TEncoded extends WireValue>(
  item: WireCodec<TInput, TEncoded>,
): WireCodec<readonly TInput[], readonly TEncoded[]> => ({
  kind: "array",
  schema: schemaOf("array", item.schema),
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

type CodecInputUnion<TCodecs extends readonly AnyWireCodec[]> = InputOf<TCodecs[number]>;

type CodecEncodedUnion<TCodecs extends readonly AnyWireCodec[]> = EncodedOf<TCodecs[number]>;

const union = <const TCodecs extends readonly AnyWireCodec[]>(
  codecs: TCodecs,
): WireCodec<CodecInputUnion<TCodecs>, CodecEncodedUnion<TCodecs>> => ({
  kind: "union",
  schema: schemaOf(
    "union",
    codecs.map((codec) => codec.schema),
  ),
  encode: (input) => {
    for (const codec of codecs) {
      const result = encodeUnknownWireValue(codec, input);
      // A successful member necessarily contributes one member of the
      // associated encoded union; registry iteration erased which member.
      if (result.ok) return result as DecodeResult<CodecEncodedUnion<TCodecs>>;
    }
    return failure("Value did not match any union member");
  },
  decode: (value) => {
    for (const codec of codecs) {
      const result = codec.decode(value);
      // As above, success identifies one member even though dynamic iteration
      // cannot retain its tuple index.
      if (result.ok) return result as DecodeResult<CodecInputUnion<TCodecs>>;
    }
    return failure("Value did not match any union member");
  },
});

export type CodecShape = Readonly<Record<string, AnyWireCodec>>;

interface OptionalWireCodec<TInput, TEncoded extends WireValue> extends WireCodec<
  TInput | undefined,
  TEncoded | undefined
> {
  readonly optional: true;
}

export type OptionalShapeKeys<TShape extends CodecShape> = {
  [TKey in keyof TShape]: TShape[TKey] extends { readonly optional: true } ? TKey : never;
}[keyof TShape];
export type RequiredShapeKeys<TShape extends CodecShape> = Exclude<
  keyof TShape,
  OptionalShapeKeys<TShape>
>;

export type ShapeInput<TShape extends CodecShape> = keyof TShape extends never
  ? EmptyObject
  : {
      readonly [TKey in RequiredShapeKeys<TShape>]: InputOf<TShape[TKey]>;
    } & {
      readonly [TKey in OptionalShapeKeys<TShape>]?: Exclude<InputOf<TShape[TKey]>, undefined>;
    };

export type ShapeEncoded<TShape extends CodecShape> = keyof TShape extends never
  ? EmptyObject
  : {
      readonly [TKey in RequiredShapeKeys<TShape>]: EncodedOf<TShape[TKey]>;
    } & {
      readonly [TKey in OptionalShapeKeys<TShape>]?: Exclude<EncodedOf<TShape[TKey]>, undefined>;
    };

const optional = <TInput, TEncoded extends WireValue>(
  codec: WireCodec<TInput, TEncoded>,
): OptionalWireCodec<TInput, TEncoded> => ({
  kind: `optional(${codec.kind})`,
  schema: schemaOf("optional", codec.schema),
  optional: true,
  encode: (input) => (input === undefined ? success(undefined) : codec.encode(input)),
  decode: (value) => (value === undefined ? success(undefined) : codec.decode(value)),
});

const record = <TInput, TEncoded extends WireValue>(
  codec: WireCodec<TInput, TEncoded>,
): WireCodec<Readonly<Record<string, TInput>>, Readonly<Record<string, TEncoded>>> => ({
  kind: `record(${codec.kind})`,
  schema: schemaOf("record", codec.schema),
  encode: (input) => processRecord(input, codec, "encode"),
  decode: (value) => processRecord(value, codec, "decode"),
});

function processRecord<TInput, TEncoded extends WireValue>(
  value: Readonly<Record<string, TInput>>,
  codec: WireCodec<TInput, TEncoded>,
  direction: "encode",
): DecodeResult<Readonly<Record<string, TEncoded>>>;
function processRecord<TInput, TEncoded extends WireValue>(
  value: unknown,
  codec: WireCodec<TInput, TEncoded>,
  direction: "decode",
): DecodeResult<Readonly<Record<string, TInput>>>;
function processRecord<TInput, TEncoded extends WireValue>(
  value: unknown,
  codec: WireCodec<TInput, TEncoded>,
  direction: "encode" | "decode",
): DecodeResult<Record<string, unknown>> {
  if (!isPlainObject(value)) return failure("Expected a plain object record");
  const output: Record<string, unknown> = Object.create(null);
  const issues: CodecIssue[] = [];
  for (const [key, entry] of Object.entries(value)) {
    // The encode overload admitted Record<string, TInput>; the shared
    // encode/decode implementation intentionally erased that branch.
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
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const object = <const TShape extends CodecShape>(
  shape: TShape,
): WireCodec<ShapeInput<TShape>, ShapeEncoded<TShape>> => ({
  kind: "object",
  schema: schemaOf(
    "object",
    Object.entries(shape)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, codec]) => [key, codec.schema]),
  ),
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
    const result =
      direction === "encode" ? encodeUnknownWireValue(codec, value[key]) : codec.decode(value[key]);
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

/** The complete built-in codec vocabulary. */
export interface WireNamespace {
  readonly string: WireCodec<string, string>;
  readonly boolean: WireCodec<boolean, boolean>;
  readonly number: WireCodec<number, number>;
  readonly finiteNumber: WireCodec<number, number>;
  readonly bigint: WireCodec<bigint, bigint>;
  readonly undefined: WireCodec<undefined, undefined>;
  readonly date: WireCodec<Date, Date>;
  readonly regexp: WireCodec<RegExp, RegExp>;
  readonly url: WireCodec<URL, URL>;
  readonly null: WireCodec<null, null>;
  readonly integer: (options?: IntegerOptions) => WireCodec<number, number>;
  readonly literal: <const TValue extends WireScalar>(
    expected: TValue,
  ) => WireCodec<TValue, TValue>;
  /**
   * A non-empty union of string literals. This is exactly the union produced
   * by `wire.union(values.map(wire.literal))`: same accepted values, encoded
   * shape, and contract digest.
   */
  readonly enum: <const TValues extends readonly [string, ...string[]]>(
    values: TValues,
  ) => WireCodec<TValues[number], TValues[number]>;
  readonly array: <TInput, TEncoded extends WireValue>(
    item: WireCodec<TInput, TEncoded>,
  ) => WireCodec<readonly TInput[], readonly TEncoded[]>;
  readonly union: <const TCodecs extends readonly AnyWireCodec[]>(
    codecs: TCodecs,
  ) => WireCodec<InputOf<TCodecs[number]>, EncodedOf<TCodecs[number]>>;
  /**
   * `wire.union([codec, wire.null])`, which is common enough in schema-backed
   * shapes to deserve a name. Exactly that union — same encoding, same wire
   * shape, same contract digest — so it is a spelling, not a new codec kind.
   *
   * Distinct from `optional`: nullable means the field is present and null,
   * optional means it may be absent.
   */
  readonly nullable: <TInput, TEncoded extends WireValue>(
    codec: WireCodec<TInput, TEncoded>,
  ) => WireCodec<TInput | null, TEncoded | null>;
  readonly optional: <TInput, TEncoded extends WireValue>(
    codec: WireCodec<TInput, TEncoded>,
  ) => WireCodec<TInput | undefined, TEncoded | undefined> & { readonly optional: true };
  readonly record: <TInput, TEncoded extends WireValue>(
    codec: WireCodec<TInput, TEncoded>,
  ) => WireCodec<Readonly<Record<string, TInput>>, Readonly<Record<string, TEncoded>>>;
  readonly object: <const TShape extends CodecShape>(
    shape: TShape,
  ) => WireCodec<ShapeInput<TShape>, ShapeEncoded<TShape>>;
  readonly serializable: <T>(
    guard: WireGuard<T>,
    options: ExternalWireSchemaOptions,
  ) => WireCodec<T, T & WireValue>;
  readonly codec: <TInput, TEncoded extends WireValue>(
    options: WireCodecOptions<TInput, TEncoded>,
  ) => WireCodec<TInput, TEncoded>;
  /**
   * The eight calendar- and clock-oriented Temporal classes as native wire
   * citizens, like `date`. Each travels as its canonical ISO string on the
   * wire and is revived with `Temporal.X.from` by the serializer. The
   * `Temporal.TimeZone` and `Temporal.Calendar` classes are identifier
   * strings in the spec, so they travel as plain `wire.string`.
   */
  readonly plainDate: WireCodec<Temporal.PlainDate, Temporal.PlainDate>;
  readonly plainDateTime: WireCodec<Temporal.PlainDateTime, Temporal.PlainDateTime>;
  readonly plainTime: WireCodec<Temporal.PlainTime, Temporal.PlainTime>;
  readonly plainYearMonth: WireCodec<Temporal.PlainYearMonth, Temporal.PlainYearMonth>;
  readonly plainMonthDay: WireCodec<Temporal.PlainMonthDay, Temporal.PlainMonthDay>;
  readonly instant: WireCodec<Temporal.Instant, Temporal.Instant>;
  readonly zonedDateTime: WireCodec<Temporal.ZonedDateTime, Temporal.ZonedDateTime>;
  readonly duration: WireCodec<Temporal.Duration, Temporal.Duration>;
  readonly standard: <TSchema extends StandardSchemaV1<unknown, unknown>>(
    schema: TSchema,
    options: ExternalWireSchemaOptions,
  ) => WireCodec<
    TSchema extends StandardSchemaV1<unknown, infer TOutput> ? TOutput : never,
    WireValue
  >;
}

export const wire: WireNamespace = {
  string: stringCodec,
  boolean: booleanCodec,
  number: numberCodec,
  finiteNumber: finiteNumberCodec,
  bigint: bigintCodec,
  undefined: undefinedCodec,
  date: dateCodec,
  plainDate: plainDateCodec,
  plainDateTime: plainDateTimeCodec,
  plainTime: plainTimeCodec,
  plainYearMonth: plainYearMonthCodec,
  plainMonthDay: plainMonthDayCodec,
  instant: instantCodec,
  zonedDateTime: zonedDateTimeCodec,
  duration: durationCodec,
  regexp: regexpCodec,
  url: urlCodec,
  null: nullCodec,
  nullable: <TInput, TEncoded extends WireValue>(codec: WireCodec<TInput, TEncoded>) =>
    union([codec, nullCodec]) as WireCodec<TInput | null, TEncoded | null>,
  integer,
  literal,
  enum: enumCodec,
  array,
  union,
  optional,
  record,
  object,
  serializable,
  codec,
  standard,
};

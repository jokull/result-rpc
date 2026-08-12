import type { StandardSchemaV1 } from "./standard-schema.js";
import { Temporal } from "temporal-polyfill";
export type WireScalar = undefined | null | boolean | string | number | bigint;
export type WireTypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array | DataView;
export type WireValue = WireScalar | Date | Temporal.PlainDate | Temporal.PlainDateTime | Temporal.PlainTime | Temporal.PlainYearMonth | Temporal.PlainMonthDay | Temporal.Instant | Temporal.ZonedDateTime | Temporal.Duration | RegExp | URL | URLSearchParams | ArrayBuffer | WireTypedArray | readonly WireValue[] | ReadonlyMap<WireValue, WireValue> | ReadonlySet<WireValue> | {
    readonly [key: string]: WireValue;
};
/** Runtime counterpart of {@link WireValue}, used at untrusted wire boundaries. */
export declare const isWireValue: (value: unknown, seen?: WeakSet<object>) => value is WireValue;
export interface CodecIssue {
    readonly path: readonly (string | number)[];
    readonly message: string;
}
export type DecodeResult<T> = Readonly<{
    ok: true;
    value: T;
}> | Readonly<{
    ok: false;
    issues: readonly CodecIssue[];
}>;
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
export declare const encodeUnknownWireValue: (codec: AnyWireCodec, input: unknown) => DecodeResult<WireValue>;
/** An object with no string properties; unlike `{}`, primitives do not satisfy it. */
export type EmptyObject = Readonly<Record<string, never>>;
/**
 * Preserve an explicit `undefined` when a codec accepts it. When it does not,
 * treat `undefined` as the conventional options placeholder for a zero-input
 * procedure and try the default empty-object input.
 */
export declare function encodeProcedureInput<TInput, TEncoded extends WireValue>(codec: WireCodec<TInput, TEncoded>, input: TInput): DecodeResult<TEncoded>;
export declare function encodeProcedureInput(codec: AnyWireCodec, input: unknown): DecodeResult<WireValue>;
export type InputOf<TCodec> = TCodec extends WireCodec<infer TInput, infer _TEncoded> ? TInput : never;
export type EncodedOf<TCodec> = TCodec extends WireCodec<infer _TInput, infer TEncoded> ? TEncoded : never;
export declare const success: <T>(value: T) => DecodeResult<T>;
export declare const failure: (message: string, path?: readonly (string | number)[]) => DecodeResult<never>;
export interface ExternalWireSchemaOptions {
    /** Stable application-owned identity; change it whenever accepted data changes. */
    readonly id: string;
}
export type WireGuard<T> = (value: unknown) => value is T;
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
export interface IntegerOptions {
    readonly min?: number;
    readonly max?: number;
}
export type CodecShape = Readonly<Record<string, AnyWireCodec>>;
export type OptionalShapeKeys<TShape extends CodecShape> = {
    [TKey in keyof TShape]: TShape[TKey] extends {
        readonly optional: true;
    } ? TKey : never;
}[keyof TShape];
export type RequiredShapeKeys<TShape extends CodecShape> = Exclude<keyof TShape, OptionalShapeKeys<TShape>>;
export type ShapeInput<TShape extends CodecShape> = keyof TShape extends never ? EmptyObject : {
    readonly [TKey in RequiredShapeKeys<TShape>]: InputOf<TShape[TKey]>;
} & {
    readonly [TKey in OptionalShapeKeys<TShape>]?: Exclude<InputOf<TShape[TKey]>, undefined>;
};
export type ShapeEncoded<TShape extends CodecShape> = keyof TShape extends never ? EmptyObject : {
    readonly [TKey in RequiredShapeKeys<TShape>]: EncodedOf<TShape[TKey]>;
} & {
    readonly [TKey in OptionalShapeKeys<TShape>]?: Exclude<EncodedOf<TShape[TKey]>, undefined>;
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
    readonly literal: <const TValue extends WireScalar>(expected: TValue) => WireCodec<TValue, TValue>;
    /**
     * A non-empty union of string literals. This is exactly the union produced
     * by `wire.union(values.map(wire.literal))`: same accepted values, encoded
     * shape, and contract digest.
     */
    readonly enum: <const TValues extends readonly [string, ...string[]]>(values: TValues) => WireCodec<TValues[number], TValues[number]>;
    readonly array: <TInput, TEncoded extends WireValue>(item: WireCodec<TInput, TEncoded>) => WireCodec<readonly TInput[], readonly TEncoded[]>;
    readonly union: <const TCodecs extends readonly AnyWireCodec[]>(codecs: TCodecs) => WireCodec<InputOf<TCodecs[number]>, EncodedOf<TCodecs[number]>>;
    /**
     * `wire.union([codec, wire.null])`, which is common enough in schema-backed
     * shapes to deserve a name. Exactly that union — same encoding, same wire
     * shape, same contract digest — so it is a spelling, not a new codec kind.
     *
     * Distinct from `optional`: nullable means the field is present and null,
     * optional means it may be absent.
     */
    readonly nullable: <TInput, TEncoded extends WireValue>(codec: WireCodec<TInput, TEncoded>) => WireCodec<TInput | null, TEncoded | null>;
    readonly optional: <TInput, TEncoded extends WireValue>(codec: WireCodec<TInput, TEncoded>) => WireCodec<TInput | undefined, TEncoded | undefined> & {
        readonly optional: true;
    };
    readonly record: <TInput, TEncoded extends WireValue>(codec: WireCodec<TInput, TEncoded>) => WireCodec<Readonly<Record<string, TInput>>, Readonly<Record<string, TEncoded>>>;
    readonly object: <const TShape extends CodecShape>(shape: TShape) => WireCodec<ShapeInput<TShape>, ShapeEncoded<TShape>>;
    readonly serializable: <T>(guard: WireGuard<T>, options: ExternalWireSchemaOptions) => WireCodec<T, T & WireValue>;
    readonly codec: <TInput, TEncoded extends WireValue>(options: WireCodecOptions<TInput, TEncoded>) => WireCodec<TInput, TEncoded>;
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
    readonly standard: <TSchema extends StandardSchemaV1<unknown, unknown>>(schema: TSchema, options: ExternalWireSchemaOptions) => WireCodec<TSchema extends StandardSchemaV1<unknown, infer TOutput> ? TOutput : never, WireValue>;
}
export declare const wire: WireNamespace;

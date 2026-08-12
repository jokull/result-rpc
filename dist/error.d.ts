import { type AnyWireCodec, type DecodeResult, type EmptyObject, type EncodedOf, type InputOf, type WireCodec, type WireValue } from "./wire.js";
import { type Err } from "./result.js";
export interface EncodedTaggedError<Tag extends string = string, Data extends WireValue = WireValue> {
    readonly _tag: Tag;
    readonly data: Data;
}
/**
 * A recoverable failure as application code observes it.
 *
 * Tagged errors cross the wire as {@link EncodedTaggedError} values and are
 * reified by their declared ErrorDefinition on the receiving side. The
 * private brand prevents a merely shape-compatible object from entering a
 * Result's error channel without an explicit unsafe cast. A locally supplied
 * standard `Error.cause` is deliberately non-enumerable and is not part of
 * the encoded representation.
 */
export declare abstract class TaggedError<Tag extends string = string, Data extends WireValue = WireValue, Visibility extends ErrorVisibility = ErrorVisibility> extends Error {
    private readonly __resultRpcTaggedError;
    readonly _tag: Tag;
    readonly data: Data;
    /** Transport eligibility inherited from the definition that created it. */
    readonly visibility: Visibility;
    protected constructor(tag: Tag, data: Data, visibility: Visibility, options?: ErrorOptions);
    /** Returns the canonical prototype-free representation used by the wire. */
    toJSON(): EncodedTaggedError<Tag, Data>;
    /** Lets a tagged error itself short-circuit a {@link gen} block. */
    [Symbol.iterator](): Generator<Err<this>, never, unknown>;
    /** Checks for a reified result-rpc TaggedError from this package runtime. */
    static is(value: unknown): value is TaggedError<string, WireValue, ErrorVisibility>;
}
export type AnyTaggedError = TaggedError<string, WireValue, ErrorVisibility>;
export type AnyPublicTaggedError = TaggedError<string, WireValue, "public">;
/** Type guard for any reified result-rpc TaggedError. */
export declare const isTaggedError: (value: unknown) => value is AnyTaggedError;
export type RetryPolicy = "never" | "transient" | "after";
/** The common HTTP failure vocabulary, usable in place of a numeric status. */
export declare const httpStatusNames: {
    readonly "bad-request": 400;
    readonly unauthorized: 401;
    readonly "payment-required": 402;
    readonly forbidden: 403;
    readonly "not-found": 404;
    readonly timeout: 408;
    readonly conflict: 409;
    readonly gone: 410;
    readonly "precondition-failed": 412;
    readonly "payload-too-large": 413;
    readonly "unprocessable-content": 422;
    readonly locked: 423;
    readonly "too-many-requests": 429;
    readonly internal: 500;
    readonly "not-implemented": 501;
    readonly "service-unavailable": 503;
};
export type HttpStatusName = keyof typeof httpStatusNames;
export type ErrorVisibility = "public" | "private";
export type ErrorSeverity = "debug" | "info" | "warning" | "error";
export interface ErrorPolicyBase<Visibility extends ErrorVisibility = ErrorVisibility> {
    readonly retry: RetryPolicy;
    readonly visibility: Visibility;
    readonly severity?: ErrorSeverity;
}
export type ErrorPolicy<Visibility extends ErrorVisibility = ErrorVisibility> = ErrorPolicyBase<Visibility> & (Visibility extends "public" ? {
    readonly httpStatus?: number;
} : {
    readonly httpStatus?: never;
});
export interface ErrorDefinitionOptionsBase<Tag extends string, Input, Data extends WireValue> {
    readonly tag: Tag;
    /** Defaults to an empty object codec. */
    readonly data?: WireCodec<Input, Data>;
    /** Defaults to `"never"` — domain errors are not retried. */
    readonly retry?: RetryPolicy;
    readonly severity?: ErrorSeverity;
}
export type ErrorDefinitionOptions<Tag extends string, Input, Data extends WireValue, Visibility extends ErrorVisibility = "public"> = ErrorDefinitionOptionsBase<Tag, Input, Data> & (Visibility extends "private" ? {
    readonly visibility: "private";
    /** Private errors never reach HTTP; fold them into a public error first. */
    readonly httpStatus?: never;
} : {
    /** Defaults to `"public"`. */
    readonly visibility?: "public";
    readonly httpStatus?: number | HttpStatusName;
});
export interface ErrorDefinition<Tag extends string, Input, Data extends WireValue, Visibility extends ErrorVisibility = ErrorVisibility> {
    /** The optional ErrorOptions retain a local cause; causes never cross the wire. */
    (...args: EmptyObject extends Input ? [input?: Input, options?: ErrorOptions] : [input: Input, options?: ErrorOptions]): TaggedError<Tag, Data, Visibility>;
    readonly tag: Tag;
    readonly codec: WireCodec<Input, Data>;
    readonly policy: Readonly<ErrorPolicy<Visibility>>;
    /** Checks for an instance created or decoded by this exact definition. */
    is(value: unknown): value is TaggedError<Tag, Data, Visibility>;
    /** Validates a wire representation and upgrades it into a TaggedError. */
    decode(value: unknown): DecodeResult<TaggedError<Tag, Data, Visibility>>;
}
/** Runtime-erased definition. Its constructor cannot be called without a proof boundary. */
export interface AnyErrorDefinition {
    readonly tag: string;
    readonly codec: AnyWireCodec;
    readonly policy: Readonly<ErrorPolicy>;
    is(value: unknown): value is AnyTaggedError;
    decode(value: unknown): DecodeResult<AnyTaggedError>;
}
/** An error definition whose instances are allowed to cross an RPC boundary. */
export interface AnyPublicErrorDefinition extends AnyErrorDefinition {
    readonly policy: Readonly<ErrorPolicy<"public">>;
    is(value: unknown): value is AnyPublicTaggedError;
    decode(value: unknown): DecodeResult<AnyPublicTaggedError>;
}
export type ErrorOf<TDefinition> = TDefinition extends ErrorDefinition<infer Tag, infer _Input, infer Data, infer Visibility> ? TaggedError<Tag, Data, Visibility> : never;
export type ErrorInputOf<TDefinition> = TDefinition extends ErrorDefinition<string, infer Input, infer _Data, infer _Visibility> ? Input : never;
export declare function error<const Tag extends string, Input, Data extends WireValue>(options: ErrorDefinitionOptions<Tag, Input, Data, "private"> & {
    readonly data: WireCodec<Input, Data>;
}): ErrorDefinition<Tag, Input, Data, "private">;
export declare function error<const Tag extends string, Input, Data extends WireValue>(options: ErrorDefinitionOptions<Tag, Input, Data, "public"> & {
    readonly data: WireCodec<Input, Data>;
}): ErrorDefinition<Tag, Input, Data, "public">;
export declare function error<const Tag extends string>(options: ErrorDefinitionOptions<Tag, EmptyObject, EmptyObject, "private"> & {
    readonly data?: undefined;
}): ErrorDefinition<Tag, EmptyObject, EmptyObject, "private">;
export declare function error<const Tag extends string>(options: ErrorDefinitionOptions<Tag, EmptyObject, EmptyObject, "public"> & {
    readonly data?: undefined;
}): ErrorDefinition<Tag, EmptyObject, EmptyObject, "public">;
/** Internal framework factory; intentionally not re-exported from the package root. */
export declare const frameworkError: <const Tag extends string, Input, Data extends WireValue>(options: ErrorDefinitionOptions<Tag, Input, Data, "public"> & {
    readonly data: WireCodec<Input, Data>;
}) => ErrorDefinition<Tag, Input, Data, "public">;
export type ErrorDefinitionInput<TDefinition extends AnyErrorDefinition> = InputOf<TDefinition["codec"]>;
export type CatalogHandlers<TDefinitions extends Readonly<Record<string, AnyErrorDefinition>>, R> = {
    readonly [TKey in keyof TDefinitions as TDefinitions[TKey]["tag"]]: (error: ErrorOf<TDefinitions[TKey]>) => R;
};
/** An exhaustive error projection that can also narrow an unknown boundary value. */
export interface ErrorCatalog<TError extends AnyTaggedError, TResult> {
    (error: TError): TResult;
    /** Whether `value` is an instance of one of this catalog's definitions. */
    is(value: unknown): value is TError;
}
/**
 * A reusable, exhaustive projection over an error definition map — the same
 * map shape middleware, shells, and layers take. Adding a definition to the
 * map breaks every catalog that has not handled the new tag; passing an error
 * outside the map is a type error at the call site.
 *
 *     const message = errorCatalog(todoErrors, {
 *       "todo/title-taken": (e) => `"${e.data.title}" already exists`,
 *       "todo/list-full": (e) => `List is full (max ${e.data.limit})`,
 *     })
 *     message(failure) // string
 */
export declare const errorCatalog: <const TDefinitions extends Readonly<Record<string, AnyErrorDefinition>>, const THandlers extends CatalogHandlers<TDefinitions, unknown>>(definitions: TDefinitions, handlers: THandlers) => ErrorCatalog<ErrorOf<TDefinitions[keyof TDefinitions]>, THandlers[keyof THandlers] extends (error: never) => infer R ? R : never>;
export type KebabCase<S extends string, Acc extends string = ""> = S extends `${infer Head}${infer Tail}` ? Head extends Lowercase<Head> ? KebabCase<Tail, `${Acc}${Head}`> : KebabCase<Tail, `${Acc}-${Lowercase<Head>}`> : Acc;
export interface ErrorSpecBase<Input, Data extends WireValue> {
    /** Defaults to an empty object codec. */
    readonly data?: WireCodec<Input, Data>;
    /** Defaults to `"never"`. */
    readonly retry?: RetryPolicy;
    readonly severity?: ErrorSeverity;
}
export type ErrorSpec<Input, Data extends WireValue, Visibility extends ErrorVisibility = "public"> = ErrorSpecBase<Input, Data> & (Visibility extends "private" ? {
    readonly visibility: "private";
    readonly httpStatus?: never;
} : {
    /** Defaults to `"public"`. */
    readonly visibility?: "public";
    readonly httpStatus?: number | HttpStatusName;
});
export type AnyErrorSpec = {
    readonly data?: AnyWireCodec;
    readonly retry?: RetryPolicy;
    readonly severity?: ErrorSeverity;
    readonly visibility?: ErrorVisibility;
    readonly httpStatus?: number | HttpStatusName;
};
export type SpecInput<TSpec> = TSpec extends {
    readonly data: infer TCodec extends AnyWireCodec;
} ? InputOf<TCodec> : EmptyObject;
export type SpecData<TSpec> = TSpec extends {
    readonly data: infer TCodec extends AnyWireCodec;
} ? EncodedOf<TCodec> : EmptyObject;
export type SpecVisibility<TSpec> = TSpec extends {
    readonly visibility: infer Visibility extends ErrorVisibility;
} ? Visibility : "public";
export type CheckedErrorSpecs<TSpecs extends Readonly<Record<string, AnyErrorSpec>>> = {
    readonly [TKey in keyof TSpecs]: TSpecs[TKey] & ErrorSpec<SpecInput<TSpecs[TKey]>, SpecData<TSpecs[TKey]> extends WireValue ? SpecData<TSpecs[TKey]> : never, SpecVisibility<TSpecs[TKey]>>;
};
export type NamespacedErrors<TNamespace extends string, TSpecs extends Readonly<Record<string, AnyErrorSpec>>> = {
    readonly [TKey in keyof TSpecs & string]: ErrorDefinition<`${TNamespace}/${KebabCase<TKey>}`, SpecInput<TSpecs[TKey]>, SpecData<TSpecs[TKey]> extends WireValue ? SpecData<TSpecs[TKey]> : never, SpecVisibility<TSpecs[TKey]>>;
};
/**
 * Declares a namespace of errors in one place. Keys become tags —
 * `notFound` under namespace `trip` is `trip/not-found` — so the tag string
 * is never written twice and cannot drift from the definition's name. The
 * returned map is the grouping currency everything else takes: procedure
 * `.errors()`, middleware, shells, layers, and catalogs.
 *
 *     export const docErrors = defineErrors("trip", {
 *       notFound: { data: wire.object({ docId: wire.string }), httpStatus: 404 },
 *       locked: { data: wire.object({ lockedBy: wire.string }), httpStatus: 409 },
 *     })
 *
 *     docErrors.notFound({ docId })  // { _tag: "trip/not-found", data: ... }
 */
export declare const defineErrors: <const TNamespace extends string, const TSpecs extends Readonly<Record<string, AnyErrorSpec>>>(namespace: TNamespace, specs: TSpecs & CheckedErrorSpecs<TSpecs>) => NamespacedErrors<TNamespace, TSpecs>;
/**
 * Selects a subset of an error map, preserving exact definition types. Useful
 * when a procedure declares only part of a namespace:
 *
 *     .errors(pickErrors(todoErrors, "titleTaken", "listFull"))
 */
export declare const pickErrors: <const TDefinitions extends Readonly<Record<string, AnyErrorDefinition>>, const TKeys extends readonly (keyof TDefinitions & string)[]>(definitions: TDefinitions, ...keys: TKeys) => Pick<TDefinitions, TKeys[number]>;

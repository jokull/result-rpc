import type { DecodeResult, InputOf, WireCodec, WireValue } from "./wire.js";
import { DEFAULT_MAX_ERROR_BYTES, serialize } from "./serializer.js";
import { err, type Err } from "./result.js";

export interface EncodedTaggedError<
  Tag extends string = string,
  Data extends WireValue = WireValue,
> {
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
export abstract class TaggedError<
  Tag extends string = string,
  Data extends WireValue = WireValue,
  Visibility extends ErrorVisibility = ErrorVisibility,
> extends Error {
  declare private readonly __resultRpcTaggedError: void;

  readonly _tag: Tag;
  readonly data: Data;
  /** Transport eligibility inherited from the definition that created it. */
  readonly visibility: Visibility;

  protected constructor(tag: Tag, data: Data, visibility: Visibility, options?: ErrorOptions) {
    const message =
      data !== null &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
        ? data.message
        : tag;
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    Object.defineProperty(this, "name", {
      value: tag,
      enumerable: false,
      configurable: true,
    });
    this._tag = tag;
    this.data = data;
    this.visibility = visibility;
  }

  /** Returns the canonical prototype-free representation used by the wire. */
  toJSON(): EncodedTaggedError<Tag, Data> {
    return { _tag: this._tag, data: this.data };
  }

  /** Lets a tagged error itself short-circuit a {@link gen} block. */
  *[Symbol.iterator](): Generator<Err<this>, never, unknown> {
    yield err(this);
    throw new TypeError("A yielded TaggedError cannot resume");
  }

  /** Checks for a reified result-rpc TaggedError from this package runtime. */
  static is(value: unknown): value is TaggedError<string, WireValue, ErrorVisibility> {
    return value instanceof TaggedError;
  }
}

export type AnyTaggedError = TaggedError<string, WireValue, ErrorVisibility>;
export type AnyPublicTaggedError = TaggedError<string, WireValue, "public">;

/** Type guard for any reified result-rpc TaggedError. */
export const isTaggedError = (value: unknown): value is AnyTaggedError => TaggedError.is(value);

export type RetryPolicy = "never" | "transient" | "after";

/** The common HTTP failure vocabulary, usable in place of a numeric status. */
export const httpStatusNames = {
  "bad-request": 400,
  unauthorized: 401,
  "payment-required": 402,
  forbidden: 403,
  "not-found": 404,
  timeout: 408,
  conflict: 409,
  gone: 410,
  "precondition-failed": 412,
  "payload-too-large": 413,
  "unprocessable-content": 422,
  locked: 423,
  "too-many-requests": 429,
  internal: 500,
  "not-implemented": 501,
  "service-unavailable": 503,
} as const;

export type HttpStatusName = keyof typeof httpStatusNames;
export type ErrorVisibility = "public" | "private";
export type ErrorSeverity = "debug" | "info" | "warning" | "error";

interface ErrorPolicyBase<Visibility extends ErrorVisibility = ErrorVisibility> {
  readonly retry: RetryPolicy;
  readonly visibility: Visibility;
  readonly severity?: ErrorSeverity;
}

export type ErrorPolicy<Visibility extends ErrorVisibility = ErrorVisibility> =
  ErrorPolicyBase<Visibility> &
    (Visibility extends "public"
      ? { readonly httpStatus?: number }
      : { readonly httpStatus?: never });

interface ErrorDefinitionOptionsBase<Tag extends string, Input, Data extends WireValue> {
  readonly tag: Tag;
  /** Defaults to an empty object codec. */
  readonly data?: WireCodec<Input, Data>;
  /** Defaults to `"never"` — domain errors are not retried. */
  readonly retry?: RetryPolicy;
  readonly severity?: ErrorSeverity;
}

export type ErrorDefinitionOptions<
  Tag extends string,
  Input,
  Data extends WireValue,
  Visibility extends ErrorVisibility = "public",
> = ErrorDefinitionOptionsBase<Tag, Input, Data> &
  (Visibility extends "private"
    ? {
        readonly visibility: "private";
        /** Private errors never reach HTTP; fold them into a public error first. */
        readonly httpStatus?: never;
      }
    : {
        /** Defaults to `"public"`. */
        readonly visibility?: "public";
        readonly httpStatus?: number | HttpStatusName;
      });

export interface ErrorDefinition<
  Tag extends string,
  Input,
  Data extends WireValue,
  Visibility extends ErrorVisibility = ErrorVisibility,
> {
  /** The optional ErrorOptions retain a local cause; causes never cross the wire. */
  (
    ...args: Record<never, never> extends Input
      ? [input?: Input, options?: ErrorOptions]
      : [input: Input, options?: ErrorOptions]
  ): TaggedError<Tag, Data, Visibility>;
  readonly tag: Tag;
  readonly codec: WireCodec<Input, Data>;
  readonly policy: Readonly<ErrorPolicy<Visibility>>;
  /** Checks for an instance created or decoded by this exact definition. */
  is(value: unknown): value is TaggedError<Tag, Data, Visibility>;
  /** Validates a wire representation and upgrades it into a TaggedError. */
  decode(value: unknown): DecodeResult<TaggedError<Tag, Data, Visibility>>;
}

// `any` is intentional in this erased registry type. Individual definitions retain
// their exact input and encoded data types through ErrorOf and ErrorInputOf.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyErrorDefinition = ErrorDefinition<string, any, any, any>;

/** An error definition whose instances are allowed to cross an RPC boundary. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPublicErrorDefinition = ErrorDefinition<string, any, any, "public">;

export type ErrorOf<TDefinition> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TDefinition extends ErrorDefinition<infer Tag, any, infer Data, infer Visibility>
    ? TaggedError<Tag, Data, Visibility>
    : never;

export type ErrorInputOf<TDefinition> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TDefinition extends ErrorDefinition<string, infer Input, any, any> ? Input : never;

const freezeWireValue = <T extends WireValue>(value: T, seen = new WeakSet<object>()): T => {
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return value;
    seen.add(value);
    Object.freeze(value);
    const children: unknown[] =
      value instanceof Map
        ? [...value.entries()].flat()
        : value instanceof Set
          ? [...value.values()]
          : Array.isArray(value)
            ? value
            : Object.values(value);
    for (const child of children) {
      if (child === undefined || child === null || typeof child !== "object") continue;
      freezeWireValue(child as WireValue, seen);
    }
  }
  return value;
};

const emptyDataCodec: WireCodec<Record<never, never>, Record<never, never>> = {
  kind: "object",
  encode: (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? { ok: true, value: {} }
      : { ok: false, issues: [{ path: [], message: "Expected an object" }] },
  decode: (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? { ok: true, value: {} }
      : { ok: false, issues: [{ path: [], message: "Expected an object" }] },
};

const createErrorDefinition = <
  const Tag extends string,
  Input,
  Data extends WireValue,
  Visibility extends ErrorVisibility,
>(
  rawOptions: ErrorDefinitionOptionsBase<Tag, Input, Data> & {
    readonly visibility: Visibility;
    readonly httpStatus?: number | HttpStatusName;
  },
  allowReservedNamespace: boolean,
): ErrorDefinition<Tag, Input, Data, Visibility> => {
  const options = {
    ...rawOptions,
    data: rawOptions.data ?? (emptyDataCodec as unknown as WireCodec<Input, Data>),
    httpStatus:
      rawOptions.visibility === "public"
        ? typeof rawOptions.httpStatus === "string"
          ? httpStatusNames[rawOptions.httpStatus]
          : rawOptions.httpStatus
        : undefined,
    retry: rawOptions.retry ?? "never",
    visibility: rawOptions.visibility,
  };
  if (!options.tag.includes("/")) {
    throw new TypeError(`Error tag must be namespaced: ${options.tag}`);
  }
  if (!allowReservedNamespace && /^(client|server|protocol|control)\//.test(options.tag)) {
    throw new TypeError(`Error tag uses a reserved framework namespace: ${options.tag}`);
  }
  if (
    options.visibility === "public" &&
    options.httpStatus !== undefined &&
    (!Number.isInteger(options.httpStatus) || options.httpStatus < 400 || options.httpStatus > 599)
  ) {
    throw new TypeError(`Invalid HTTP error status: ${options.httpStatus}`);
  }
  if (options.visibility === "private" && rawOptions.httpStatus !== undefined) {
    throw new TypeError("Private errors cannot declare an HTTP status");
  }

  class DefinedTaggedError extends TaggedError<Tag, Data, Visibility> {
    constructor(data: Data, errorOptions?: ErrorOptions) {
      super(options.tag, data, options.visibility, errorOptions);
      Object.freeze(this);
    }
  }

  const instantiate = (
    data: Data,
    errorOptions?: ErrorOptions,
  ): TaggedError<Tag, Data, Visibility> =>
    new DefinedTaggedError(freezeWireValue(data), errorOptions);

  const decodeUnsafe = (value: unknown): DecodeResult<TaggedError<Tag, Data, Visibility>> => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, issues: [{ path: [], message: "Expected a tagged error object" }] };
    }
    const candidate = value as { readonly _tag?: unknown; readonly data?: unknown };
    if (candidate._tag !== options.tag) {
      return { ok: false, issues: [{ path: ["_tag"], message: `Expected ${options.tag}` }] };
    }
    const decoded = options.data.decode(candidate.data);
    if (!decoded.ok) {
      return {
        ok: false,
        issues: decoded.issues.map((issue) => ({ ...issue, path: ["data", ...issue.path] })),
      };
    }
    const encoded = options.data.encode(decoded.value);
    if (!encoded.ok) return encoded;
    const wireCheck = serialize(
      { _tag: options.tag, data: encoded.value },
      { maxBytes: DEFAULT_MAX_ERROR_BYTES },
    );
    if (!wireCheck.ok) {
      return {
        ok: false,
        issues: [{ path: ["data"], message: "Error data is not wire-serializable" }],
      };
    }
    return {
      ok: true,
      value: instantiate(encoded.value),
    };
  };

  const decode = (value: unknown): DecodeResult<TaggedError<Tag, Data, Visibility>> => {
    try {
      return decodeUnsafe(value);
    } catch {
      return {
        ok: false,
        issues: [{ path: ["data"], message: "Error data codec failed" }],
      };
    }
  };

  const definition = ((input: Input = {} as Input, errorOptions?: ErrorOptions) => {
    const encoded = options.data.encode(input);
    if (!encoded.ok) {
      const details = encoded.issues
        .map((issue) => `${issue.path.join(".") || "data"}: ${issue.message}`)
        .join("; ");
      throw new TypeError(`Invalid data for ${options.tag}: ${details}`);
    }
    const wireValue = { _tag: options.tag, data: encoded.value } as const;
    const wireCheck = serialize(wireValue, { maxBytes: DEFAULT_MAX_ERROR_BYTES });
    if (!wireCheck.ok) {
      throw new TypeError(
        `Invalid data for ${options.tag}: ${wireCheck.path ?? "data"} is not wire-serializable`,
      );
    }
    return instantiate(encoded.value, errorOptions);
  }) as unknown as ErrorDefinition<Tag, Input, Data, Visibility>;

  Object.defineProperties(definition, {
    tag: { value: options.tag, enumerable: true },
    codec: { value: options.data, enumerable: true },
    policy: {
      value: Object.freeze({
        ...(options.visibility === "public" && options.httpStatus !== undefined
          ? { httpStatus: options.httpStatus }
          : {}),
        retry: options.retry,
        visibility: options.visibility,
        ...(options.severity === undefined ? {} : { severity: options.severity }),
      }),
      enumerable: true,
    },
    is: { value: (value: unknown) => value instanceof DefinedTaggedError },
    decode: { value: decode },
  });

  return Object.freeze(definition);
};

export function error<const Tag extends string, Input, Data extends WireValue>(
  options: ErrorDefinitionOptions<Tag, Input, Data, "private"> & {
    readonly data: WireCodec<Input, Data>;
  },
): ErrorDefinition<Tag, Input, Data, "private">;
export function error<const Tag extends string, Input, Data extends WireValue>(
  options: ErrorDefinitionOptions<Tag, Input, Data, "public"> & {
    readonly data: WireCodec<Input, Data>;
  },
): ErrorDefinition<Tag, Input, Data, "public">;
export function error<const Tag extends string>(
  options: ErrorDefinitionOptions<Tag, Record<never, never>, Record<never, never>, "private"> & {
    readonly data?: undefined;
  },
): ErrorDefinition<Tag, Record<never, never>, Record<never, never>, "private">;
export function error<const Tag extends string>(
  options: ErrorDefinitionOptions<Tag, Record<never, never>, Record<never, never>, "public"> & {
    readonly data?: undefined;
  },
): ErrorDefinition<Tag, Record<never, never>, Record<never, never>, "public">;
export function error<const Tag extends string, Input, Data extends WireValue>(
  options: ErrorDefinitionOptions<Tag, Input, Data, ErrorVisibility>,
): ErrorDefinition<Tag, Input, Data, ErrorVisibility> {
  return createErrorDefinition(
    {
      ...options,
      visibility: options.visibility ?? "public",
    },
    false,
  );
}

/** Internal framework factory; intentionally not re-exported from the package root. */
export const frameworkError = <const Tag extends string, Input, Data extends WireValue>(
  options: ErrorDefinitionOptions<Tag, Input, Data, "public">,
): ErrorDefinition<Tag, Input, Data, "public"> =>
  createErrorDefinition(
    {
      ...options,
      visibility: options.visibility ?? "public",
    },
    true,
  );

export type ErrorDefinitionInput<TDefinition extends AnyErrorDefinition> = InputOf<
  TDefinition["codec"]
>;

type CatalogHandlers<TDefinitions extends Readonly<Record<string, AnyErrorDefinition>>, R> = {
  readonly [TKey in keyof TDefinitions as TDefinitions[TKey]["tag"]]: (
    error: ErrorOf<TDefinitions[TKey]>,
  ) => R;
};

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
export const errorCatalog = <
  const TDefinitions extends Readonly<Record<string, AnyErrorDefinition>>,
  const THandlers extends CatalogHandlers<TDefinitions, unknown>,
>(
  definitions: TDefinitions,
  handlers: THandlers,
): ((
  error: ErrorOf<TDefinitions[keyof TDefinitions]>,
) => THandlers[keyof THandlers] extends (error: never) => infer R ? R : never) => {
  type R = THandlers[keyof THandlers] extends (error: never) => infer TReturn ? TReturn : never;
  const tags = new Set(Object.values(definitions).map((definition) => definition.tag));
  for (const tag of Object.keys(handlers)) {
    if (!tags.has(tag)) throw new TypeError(`Catalog handles unknown tag ${tag}`);
  }
  for (const tag of tags) {
    if (!(tag in handlers)) throw new TypeError(`Catalog is missing tag ${tag}`);
  }
  return (error) =>
    (handlers as unknown as Record<string, (error: AnyTaggedError) => R>)[error._tag]!(error);
};

// --- Namespaced declaration -------------------------------------------------

type KebabCase<S extends string, Acc extends string = ""> = S extends `${infer Head}${infer Tail}`
  ? Head extends Lowercase<Head>
    ? KebabCase<Tail, `${Acc}${Head}`>
    : KebabCase<Tail, `${Acc}-${Lowercase<Head>}`>
  : Acc;

interface ErrorSpecBase<Input, Data extends WireValue> {
  /** Defaults to an empty object codec. */
  readonly data?: WireCodec<Input, Data>;
  /** Defaults to `"never"`. */
  readonly retry?: RetryPolicy;
  readonly severity?: ErrorSeverity;
}

export type ErrorSpec<
  Input,
  Data extends WireValue,
  Visibility extends ErrorVisibility = "public",
> = ErrorSpecBase<Input, Data> &
  (Visibility extends "private"
    ? {
        readonly visibility: "private";
        readonly httpStatus?: never;
      }
    : {
        /** Defaults to `"public"`. */
        readonly visibility?: "public";
        readonly httpStatus?: number | HttpStatusName;
      });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyErrorSpec = ErrorSpecBase<any, any> & {
  readonly visibility?: ErrorVisibility;
  readonly httpStatus?: number | HttpStatusName;
};

type SpecInput<TSpec> = TSpec extends { readonly data: WireCodec<infer Input, WireValue> }
  ? Input
  : Record<never, never>;
type SpecData<TSpec> = TSpec extends { readonly data: WireCodec<unknown, infer Data> }
  ? Data
  : Record<never, never>;
type SpecVisibility<TSpec> = TSpec extends {
  readonly visibility: infer Visibility extends ErrorVisibility;
}
  ? Visibility
  : "public";
type CheckedErrorSpecs<TSpecs extends Readonly<Record<string, AnyErrorSpec>>> = {
  readonly [TKey in keyof TSpecs]: TSpecs[TKey] &
    ErrorSpec<
      SpecInput<TSpecs[TKey]>,
      SpecData<TSpecs[TKey]> extends WireValue ? SpecData<TSpecs[TKey]> : never,
      SpecVisibility<TSpecs[TKey]>
    >;
};

export type NamespacedErrors<
  TNamespace extends string,
  TSpecs extends Readonly<Record<string, AnyErrorSpec>>,
> = {
  readonly [TKey in keyof TSpecs & string]: ErrorDefinition<
    `${TNamespace}/${KebabCase<TKey>}`,
    SpecInput<TSpecs[TKey]>,
    SpecData<TSpecs[TKey]> extends WireValue ? SpecData<TSpecs[TKey]> : never,
    SpecVisibility<TSpecs[TKey]>
  >;
};

const kebabCase = (value: string): string =>
  value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

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
export const defineErrors = <
  const TNamespace extends string,
  const TSpecs extends Readonly<Record<string, AnyErrorSpec>>,
>(
  namespace: TNamespace,
  specs: TSpecs & CheckedErrorSpecs<TSpecs>,
): NamespacedErrors<TNamespace, TSpecs> => {
  if (namespace.includes("/")) {
    throw new TypeError(`Error namespace must not contain "/": ${namespace}`);
  }
  const definitions: Record<string, AnyErrorDefinition> = {};
  for (const [key, spec] of Object.entries(specs)) {
    definitions[key] = createErrorDefinition(
      {
        ...spec,
        tag: `${namespace}/${kebabCase(key)}`,
        visibility: spec.visibility ?? "public",
      },
      false,
    ) as AnyErrorDefinition;
  }
  return Object.freeze(definitions) as NamespacedErrors<TNamespace, TSpecs>;
};

/**
 * Selects a subset of an error map, preserving exact definition types. Useful
 * when a procedure declares only part of a namespace:
 *
 *     .errors(pickErrors(todoErrors, "titleTaken", "listFull"))
 */
export const pickErrors = <
  const TDefinitions extends Readonly<Record<string, AnyErrorDefinition>>,
  const TKeys extends readonly (keyof TDefinitions & string)[],
>(
  definitions: TDefinitions,
  ...keys: TKeys
): Pick<TDefinitions, TKeys[number]> => {
  const picked: Record<string, AnyErrorDefinition> = {};
  for (const key of keys) {
    const definition = definitions[key];
    if (!definition) throw new TypeError(`Unknown error key ${key}`);
    picked[key] = definition;
  }
  return Object.freeze(picked) as Pick<TDefinitions, TKeys[number]>;
};

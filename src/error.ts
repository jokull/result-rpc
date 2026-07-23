import type { DecodeResult, InputOf, WireCodec, WireValue } from "./wire.js";
import { DEFAULT_MAX_ERROR_BYTES, serialize } from "./serializer.js";

export interface TaggedError<
  Tag extends string = string,
  Data extends WireValue = WireValue,
> {
  readonly _tag: Tag;
  readonly data: Data;
}

export type AnyTaggedError = TaggedError<string, WireValue>;

export type RetryPolicy = "never" | "transient" | "after";
export type ErrorVisibility = "public" | "private";
export type ErrorSeverity = "debug" | "info" | "warning" | "error";

export interface ErrorPolicy {
  readonly httpStatus: number;
  readonly retry: RetryPolicy;
  readonly visibility: ErrorVisibility;
  readonly severity?: ErrorSeverity;
}

export interface ErrorDefinitionOptions<
  Tag extends string,
  Input,
  Data extends WireValue,
> {
  readonly tag: Tag;
  /** Defaults to an empty object codec. */
  readonly data?: WireCodec<Input, Data>;
  readonly httpStatus: number;
  /** Defaults to `"never"` — domain errors are not retried. */
  readonly retry?: RetryPolicy;
  /** Defaults to `"public"`. */
  readonly visibility?: ErrorVisibility;
  readonly severity?: ErrorSeverity;
}

export interface ErrorDefinition<
  Tag extends string,
  Input,
  Data extends WireValue,
> {
  (
    ...args: Record<never, never> extends Input ? [input?: Input] : [input: Input]
  ): TaggedError<Tag, Data>;
  readonly tag: Tag;
  readonly codec: WireCodec<Input, Data>;
  readonly policy: Readonly<ErrorPolicy>;
  is(value: unknown): value is TaggedError<Tag, Data>;
  decode(value: unknown): DecodeResult<TaggedError<Tag, Data>>;
}

// `any` is intentional in this erased registry type. Individual definitions retain
// their exact input and encoded data types through ErrorOf and ErrorInputOf.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyErrorDefinition = ErrorDefinition<string, any, any>;

export type ErrorOf<TDefinition> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TDefinition extends ErrorDefinition<infer Tag, any, infer Data>
    ? TaggedError<Tag, Data>
    : never;

export type ErrorInputOf<TDefinition> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TDefinition extends ErrorDefinition<string, infer Input, any>
    ? Input
    : never;

const freezeWireValue = <T extends WireValue>(value: T, seen = new WeakSet<object>()): T => {
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return value;
    seen.add(value);
    Object.freeze(value);
    const children: unknown[] = value instanceof Map
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
  encode: (value) => value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ok: true, value: {} }
    : { ok: false, issues: [{ path: [], message: "Expected an object" }] },
  decode: (value) => value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ok: true, value: {} }
    : { ok: false, issues: [{ path: [], message: "Expected an object" }] },
};

const createErrorDefinition = <
  const Tag extends string,
  Input,
  Data extends WireValue,
>(
  rawOptions: ErrorDefinitionOptions<Tag, Input, Data>,
  allowReservedNamespace: boolean,
): ErrorDefinition<Tag, Input, Data> => {
  const options = {
    ...rawOptions,
    data: rawOptions.data ?? (emptyDataCodec as unknown as WireCodec<Input, Data>),
    retry: rawOptions.retry ?? "never",
    visibility: rawOptions.visibility ?? "public",
  };
  if (!options.tag.includes("/")) {
    throw new TypeError(`Error tag must be namespaced: ${options.tag}`);
  }
  if (
    !allowReservedNamespace
    && /^(client|server|protocol|control)\//.test(options.tag)
  ) {
    throw new TypeError(`Error tag uses a reserved framework namespace: ${options.tag}`);
  }
  if (!Number.isInteger(options.httpStatus) || options.httpStatus < 400 || options.httpStatus > 599) {
    throw new TypeError(`Invalid HTTP error status: ${options.httpStatus}`);
  }

  const decodeUnsafe = (value: unknown): DecodeResult<TaggedError<Tag, Data>> => {
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
      value: freezeWireValue({ _tag: options.tag, data: encoded.value }),
    };
  };

  const decode = (value: unknown): DecodeResult<TaggedError<Tag, Data>> => {
    try {
      return decodeUnsafe(value);
    } catch {
      return {
        ok: false,
        issues: [{ path: ["data"], message: "Error data codec failed" }],
      };
    }
  };

  const definition = ((input: Input = {} as Input) => {
    const encoded = options.data.encode(input);
    if (!encoded.ok) {
      const details = encoded.issues
        .map((issue) => `${issue.path.join(".") || "data"}: ${issue.message}`)
        .join("; ");
      throw new TypeError(`Invalid data for ${options.tag}: ${details}`);
    }
    const value = { _tag: options.tag, data: encoded.value } as const;
    const wireCheck = serialize(value, { maxBytes: DEFAULT_MAX_ERROR_BYTES });
    if (!wireCheck.ok) {
      throw new TypeError(
        `Invalid data for ${options.tag}: ${wireCheck.path ?? "data"} is not wire-serializable`,
      );
    }
    return freezeWireValue(value);
  }) as unknown as ErrorDefinition<Tag, Input, Data>;

  Object.defineProperties(definition, {
    tag: { value: options.tag, enumerable: true },
    codec: { value: options.data, enumerable: true },
    policy: {
      value: Object.freeze({
        httpStatus: options.httpStatus,
        retry: options.retry,
        visibility: options.visibility,
        ...(options.severity === undefined ? {} : { severity: options.severity }),
      }),
      enumerable: true,
    },
    is: { value: (value: unknown) => decode(value).ok },
    decode: { value: decode },
  });

  return Object.freeze(definition);
};

export function error<const Tag extends string, Input, Data extends WireValue>(
  options: ErrorDefinitionOptions<Tag, Input, Data> & { readonly data: WireCodec<Input, Data> },
): ErrorDefinition<Tag, Input, Data>;
export function error<const Tag extends string>(
  options: ErrorDefinitionOptions<Tag, Record<never, never>, Record<never, never>> & { readonly data?: undefined },
): ErrorDefinition<Tag, Record<never, never>, Record<never, never>>;
export function error<const Tag extends string, Input, Data extends WireValue>(
  options: ErrorDefinitionOptions<Tag, Input, Data>,
): ErrorDefinition<Tag, Input, Data> {
  return createErrorDefinition(options, false);
}

/** Internal framework factory; intentionally not re-exported from the package root. */
export const frameworkError = <const Tag extends string, Input, Data extends WireValue>(
  options: ErrorDefinitionOptions<Tag, Input, Data>,
): ErrorDefinition<Tag, Input, Data> => createErrorDefinition(options, true);

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

type KebabCase<S extends string, Acc extends string = ""> =
  S extends `${infer Head}${infer Tail}`
    ? Head extends Lowercase<Head>
      ? KebabCase<Tail, `${Acc}${Head}`>
      : KebabCase<Tail, `${Acc}-${Lowercase<Head>}`>
    : Acc;

export interface ErrorSpec<Input, Data extends WireValue> {
  /** Defaults to an empty object codec. */
  readonly data?: WireCodec<Input, Data>;
  readonly httpStatus: number;
  /** Defaults to `"never"`. */
  readonly retry?: RetryPolicy;
  /** Defaults to `"public"`. */
  readonly visibility?: ErrorVisibility;
  readonly severity?: ErrorSeverity;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyErrorSpec = ErrorSpec<any, any>;

type SpecInput<TSpec> = TSpec extends { readonly data: WireCodec<infer Input, WireValue> }
  ? Input
  : Record<never, never>;
type SpecData<TSpec> = TSpec extends { readonly data: WireCodec<unknown, infer Data> }
  ? Data
  : Record<never, never>;

export type NamespacedErrors<
  TNamespace extends string,
  TSpecs extends Readonly<Record<string, AnyErrorSpec>>,
> = {
  readonly [TKey in keyof TSpecs & string]: ErrorDefinition<
    `${TNamespace}/${KebabCase<TKey>}`,
    SpecInput<TSpecs[TKey]>,
    SpecData<TSpecs[TKey]> extends WireValue ? SpecData<TSpecs[TKey]> : never
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
 *     export const tripErrors = defineErrors("trip", {
 *       notFound: { data: wire.object({ tripId: wire.string }), httpStatus: 404 },
 *       locked: { data: wire.object({ lockedBy: wire.string }), httpStatus: 409 },
 *     })
 *
 *     tripErrors.notFound({ tripId })  // { _tag: "trip/not-found", data: ... }
 */
export const defineErrors = <
  const TNamespace extends string,
  const TSpecs extends Readonly<Record<string, AnyErrorSpec>>,
>(
  namespace: TNamespace,
  specs: TSpecs,
): NamespacedErrors<TNamespace, TSpecs> => {
  if (namespace.includes("/")) {
    throw new TypeError(`Error namespace must not contain "/": ${namespace}`);
  }
  const definitions: Record<string, AnyErrorDefinition> = {};
  for (const [key, spec] of Object.entries(specs)) {
    definitions[key] = createErrorDefinition(
      { ...spec, tag: `${namespace}/${kebabCase(key)}` },
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

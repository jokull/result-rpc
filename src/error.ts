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
> extends ErrorPolicy {
  readonly tag: Tag;
  readonly data: WireCodec<Input, Data>;
}

export interface ErrorDefinition<
  Tag extends string,
  Input,
  Data extends WireValue,
> {
  (input: Input): TaggedError<Tag, Data>;
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

const createErrorDefinition = <
  const Tag extends string,
  Input,
  Data extends WireValue,
>(
  options: ErrorDefinitionOptions<Tag, Input, Data>,
  allowReservedNamespace: boolean,
): ErrorDefinition<Tag, Input, Data> => {
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

  const definition = ((input: Input) => {
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
  }) as ErrorDefinition<Tag, Input, Data>;

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

export const error = <const Tag extends string, Input, Data extends WireValue>(
  options: ErrorDefinitionOptions<Tag, Input, Data>,
): ErrorDefinition<Tag, Input, Data> => createErrorDefinition(options, false);

/** Internal framework factory; intentionally not re-exported from the package root. */
export const frameworkError = <const Tag extends string, Input, Data extends WireValue>(
  options: ErrorDefinitionOptions<Tag, Input, Data>,
): ErrorDefinition<Tag, Input, Data> => createErrorDefinition(options, true);

export type ErrorDefinitionInput<TDefinition extends AnyErrorDefinition> = InputOf<
  TDefinition["codec"]
>;

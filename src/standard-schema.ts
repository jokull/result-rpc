import type { ServerBadRequest } from "./framework-errors.js";
import type { WireCodec, WireValue } from "./wire.js";

/**
 * Forms from the contract.
 *
 * A procedure's input codec already knows every field's shape and rules, so
 * it doubles as the form schema: `toStandardSchema(codec)` (or `$schema` on a
 * client procedure) exposes it through the Standard Schema V1 interface
 * (standardschema.dev) — the spec form libraries and validators consume —
 * with zero dependencies. One declaration then drives field types, client
 * validation, server validation, and field-level errors, and cannot drift.
 */

/** The Standard Schema V1 interface, declared locally — no dependency. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] };

const memo = new WeakMap<object, StandardSchemaV1<unknown, unknown>>();

export const toStandardSchema = <TInput>(
  codec: WireCodec<TInput, WireValue>,
): StandardSchemaV1<TInput> => {
  const cached = memo.get(codec);
  if (cached) return cached as StandardSchemaV1<TInput>;
  const schema: StandardSchemaV1<TInput> = {
    "~standard": {
      version: 1,
      vendor: "result-rpc",
      validate: (value) => {
        try {
          const encoded = codec.encode(value as TInput);
          if (encoded.ok) return { value: value as TInput };
          return {
            issues: encoded.issues.map((issue) => ({
              message: issue.message,
              ...(issue.path.length === 0 ? {} : { path: [...issue.path] }),
            })),
          };
        } catch {
          return { issues: [{ message: "Value could not be validated" }] };
        }
      },
    },
  };
  memo.set(codec, schema as StandardSchemaV1<unknown, unknown>);
  return schema;
};

/**
 * Projects a `server/bad-request` failure onto form fields: issue paths become
 * dot-joined keys, exactly matching the input codec's field paths — the same
 * shape client-side validation produced before submit. One codec, one set of
 * paths, both sides of the wire.
 */
export const fieldIssues = (
  failure: ServerBadRequest,
): Readonly<Record<string, readonly string[]>> => {
  const fields: Record<string, string[]> = {};
  for (const issue of failure.data.issues) {
    const key = issue.path.join(".");
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
};

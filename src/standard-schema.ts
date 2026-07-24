import type { ServerBadRequest } from "./framework-errors.js";

/**
 * The Standard Schema V1 interface (standardschema.dev), declared locally —
 * no dependency. result-rpc consumes it in one deliberate direction:
 * `wire.standard(schema)` adopts a validator (Valibot, Zod, ArkType) as a
 * wire input codec.
 *
 * There is intentionally no codec→form direction. A form validates a human
 * (string values, coercion, progressive feedback, usually a projection of
 * the eventual input); the wire validates an application boundary (typed,
 * hostile, complete). They are different jobs, and a wire codec handed to a
 * form library fights the form at every text input.
 */
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

/**
 * Projects a `server/bad-request` failure onto form fields: issue paths
 * become dot-joined keys. Paths are shaped like the *procedure input* — when
 * a form edits a projection of the input (it usually does), map the keys
 * where the shapes diverge.
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

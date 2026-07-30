import type { ServerBadRequest } from "./framework-errors.js";

/**
 * The Standard Schema V1 interface (standardschema.dev), declared locally —
 * no dependency. result-rpc consumes it in one deliberate direction:
 * `wire.standard(schema, { id })` adopts a validator (Valibot, Zod, ArkType) as a
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

const dotKey = (
  path: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined,
): string =>
  (path ?? [])
    .map((segment) =>
      typeof segment === "object" && segment !== null ? String(segment.key) : String(segment),
    )
    .join(".");

/**
 * The outcome of running a Standard Schema synchronously: the parsed value,
 * or its issues — both raw and already projected onto dot-joined field keys,
 * ready for form state.
 */
export type StandardValidation<Output> =
  | Readonly<{ ok: true; value: Output }>
  | Readonly<{
      ok: false;
      issues: readonly StandardSchemaIssue[];
      fields: Readonly<Record<string, readonly string[]>>;
    }>;

/**
 * Runs a Standard Schema against a value, synchronously — the form-side
 * companion to `wire.standard`. The doctrine is "the form validates the
 * human before the wire is ever involved"; this is the two-line way to do
 * it without touching the `~standard` spec plumbing:
 *
 * ```ts
 * const validated = validateStandard(createIssueSchema, { id, title })
 * if (!validated.ok) return setFieldErrors(validated.fields)
 * await create.mutate(validated.value)
 * ```
 *
 * Throws on async schemas — validation that suspends cannot run during a
 * render or a submit handler, and the wire side (`wire.standard`) rejects
 * them for the same reason.
 */
export const validateStandard = <Input, Output>(
  schema: StandardSchemaV1<Input, Output>,
  value: unknown,
): StandardValidation<Output> => {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new TypeError(
      "validateStandard requires a synchronous schema — async validation cannot run during render or submit",
    );
  }
  if (result.issues) {
    const fields: Record<string, string[]> = {};
    for (const issue of result.issues) {
      (fields[dotKey(issue.path)] ??= []).push(issue.message);
    }
    return { ok: false, issues: result.issues, fields };
  }
  return { ok: true, value: result.value };
};

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

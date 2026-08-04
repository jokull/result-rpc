/**
 * Per-procedure Result codec — the boundary's serialization/reification
 * primitive, built from better-result's `Result.codec` and internal Standard
 * Schema adapters around the existing wire codecs and error registry.
 *
 * The Ok branch adapts the procedure's output `WireCodec` (app value ↔ wire
 * value); the Err branch adapts the procedure's declared error registry:
 *
 * - `serialize.err` accepts only an instance from the registry with public
 *   visibility — counterfeit, foreign, private, or malformed errors are
 *   rejected with issues, which `Result.codec` wraps in
 *   `ResultSerializationError`.
 * - `deserialize.err` validates an encoded `{ _tag, data }`, resolves the
 *   exact definition, decodes its data codec, and reconstructs the
 *   corresponding result-rpc TaggedError instance.
 *
 * Codec failures are boundary implementation details: they translate to
 * result-rpc framework failures and never leak into application error unions.
 */
import { Result as BetterResult, type ResultCodec, type StandardSchemaV1 } from "better-result";
import { isTaggedError, type AnyPublicErrorDefinition, type EncodedTaggedError } from "./error.js";
import type { ErrorDefinitionMap } from "./error-map.js";
import type { AnyWireCodec, WireValue } from "./wire.js";

/** result-rpc's Standard Schema issues are { path, message } — a CodecIssue. */
const toStandardIssues = (
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
) => issues.map((issue) => ({ path: issue.path, message: issue.message }));

const encodeSchema = (codec: AnyWireCodec): StandardSchemaV1<unknown, WireValue> => ({
  "~standard": {
    version: 1,
    vendor: "result-rpc",
    validate: (input) => {
      // The output codec is erased to AnyWireCodec at the boundary — the
      // audited dynamic-encode cast, exactly like encodeUnknownWireValue.
      const encoded = codec.encode(input as never);
      return encoded.ok ? { value: encoded.value } : { issues: toStandardIssues(encoded.issues) };
    },
  },
});

const decodeSchema = (codec: AnyWireCodec): StandardSchemaV1<WireValue, unknown> => ({
  "~standard": {
    version: 1,
    vendor: "result-rpc",
    validate: (value) => {
      const decoded = codec.decode(value);
      return decoded.ok ? { value: decoded.value } : { issues: toStandardIssues(decoded.issues) };
    },
  },
});

const registry = (
  definitions: ErrorDefinitionMap,
): ReadonlyMap<string, AnyPublicErrorDefinition> => {
  // ErrorDefinitionMap keys are declaration names; the codec resolves by tag,
  // exactly like the boundary's original `find(candidate => candidate.tag === ...)`.
  const byTag = new Map<string, AnyPublicErrorDefinition>();
  for (const definition of Object.values(definitions)) byTag.set(definition.tag, definition);
  return byTag;
};

/**
 * Err → encoded wire: a declared, public, exact instance becomes
 * `{ _tag, data }`. Everything else is a codec issue.
 */
const declaredErrorsToWire = (
  definitions: ReadonlyMap<string, AnyPublicErrorDefinition>,
): StandardSchemaV1<unknown, EncodedTaggedError> => ({
  "~standard": {
    version: 1,
    vendor: "result-rpc",
    validate: (value) => {
      if (!isTaggedError(value)) {
        return { issues: [{ path: [], message: "Not a tagged error" }] };
      }
      const definition = definitions.get(value._tag);
      if (
        definition === undefined ||
        definition.policy.visibility !== "public" ||
        !definition.is(value)
      ) {
        return {
          issues: [{ path: ["_tag"], message: "Unknown, private, or counterfeit error" }],
        };
      }
      const encoded = definition.codec.encode(value.data as never);
      if (!encoded.ok) {
        return {
          issues: toStandardIssues(encoded.issues).map((issue) => ({
            ...issue,
            path: ["data", ...(issue.path ?? [])],
          })),
        };
      }
      return { value: { _tag: value._tag, data: encoded.value } };
    },
  },
});

/**
 * Encoded wire → Err: `{ _tag, data }` resolves against the registry, its
 * data codec decodes, and the exact result-rpc TaggedError instance is
 * reconstructed. Unknown, private, malformed, or counterfeit tags are issues.
 */
const declaredErrorsFromWire = (
  definitions: ReadonlyMap<string, AnyPublicErrorDefinition>,
): StandardSchemaV1<unknown, unknown> => ({
  "~standard": {
    version: 1,
    vendor: "result-rpc",
    validate: (value) => {
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("_tag" in value) ||
        typeof value._tag !== "string"
      ) {
        return { issues: [{ path: [], message: "Expected an encoded tagged error" }] };
      }
      const definition = definitions.get(value._tag);
      if (definition === undefined || definition.policy.visibility !== "public") {
        return { issues: [{ path: ["_tag"], message: "Unknown or private error tag" }] };
      }
      const reified = definition.decode(value);
      if (!reified.ok) {
        return { issues: toStandardIssues(reified.issues) };
      }
      return { value: reified.value };
    },
  },
});

export type ProcedureResultCodec = ResultCodec<
  StandardSchemaV1<unknown, WireValue>,
  StandardSchemaV1<unknown, EncodedTaggedError>,
  StandardSchemaV1<WireValue, unknown>,
  StandardSchemaV1<unknown, unknown>
>;

/**
 * The per-procedure Result codec: Ok values ride the procedure's output wire
 * codec, Err values ride its declared error registry.
 */
export const procedureResultCodec = (
  output: AnyWireCodec,
  definitions: ErrorDefinitionMap,
): ProcedureResultCodec => {
  const errorDefinitions = registry(definitions);
  return BetterResult.codec({
    serialize: {
      ok: encodeSchema(output),
      err: declaredErrorsToWire(errorDefinitions),
    },
    deserialize: {
      ok: decodeSchema(output),
      err: declaredErrorsFromWire(errorDefinitions),
    },
  });
};

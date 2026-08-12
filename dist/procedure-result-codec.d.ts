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
import { type ResultCodec, type StandardSchemaV1 } from "better-result";
import { type EncodedTaggedError } from "./error.js";
import type { ErrorDefinitionMap } from "./error-map.js";
import type { AnyWireCodec, WireValue } from "./wire.js";
export type ProcedureResultCodec = ResultCodec<StandardSchemaV1<unknown, WireValue>, StandardSchemaV1<unknown, EncodedTaggedError>, StandardSchemaV1<WireValue, unknown>, StandardSchemaV1<unknown, unknown>>;
/**
 * The per-procedure Result codec: Ok values ride the procedure's output wire
 * codec, Err values ride its declared error registry.
 */
export declare const procedureResultCodec: (output: AnyWireCodec, definitions: ErrorDefinitionMap) => ProcedureResultCodec;

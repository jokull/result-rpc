import { isTaggedError } from "./error.js";
import { Result } from "better-result";
//#region src/procedure-result-codec.ts
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
/** result-rpc's Standard Schema issues are { path, message } — a CodecIssue. */
const toStandardIssues = (issues) => issues.map((issue) => ({
	path: issue.path,
	message: issue.message
}));
const encodeSchema = (codec) => ({ "~standard": {
	version: 1,
	vendor: "result-rpc",
	validate: (input) => {
		const encoded = codec.encode(input);
		return encoded.ok ? { value: encoded.value } : { issues: toStandardIssues(encoded.issues) };
	}
} });
const decodeSchema = (codec) => ({ "~standard": {
	version: 1,
	vendor: "result-rpc",
	validate: (value) => {
		const decoded = codec.decode(value);
		return decoded.ok ? { value: decoded.value } : { issues: toStandardIssues(decoded.issues) };
	}
} });
const registry = (definitions) => {
	const byTag = /* @__PURE__ */ new Map();
	for (const definition of Object.values(definitions)) byTag.set(definition.tag, definition);
	return byTag;
};
/**
* Err → encoded wire: a declared, public, exact instance becomes
* `{ _tag, data }`. Everything else is a codec issue.
*/
const declaredErrorsToWire = (definitions) => ({ "~standard": {
	version: 1,
	vendor: "result-rpc",
	validate: (value) => {
		if (!isTaggedError(value)) return { issues: [{
			path: [],
			message: "Not a tagged error"
		}] };
		const definition = definitions.get(value._tag);
		if (definition === void 0 || definition.policy.visibility !== "public" || !definition.is(value)) return { issues: [{
			path: ["_tag"],
			message: "Unknown, private, or counterfeit error"
		}] };
		const encoded = definition.codec.encode(value.data);
		if (!encoded.ok) return { issues: toStandardIssues(encoded.issues).map((issue) => ({
			...issue,
			path: ["data", ...issue.path ?? []]
		})) };
		return { value: {
			_tag: value._tag,
			data: encoded.value
		} };
	}
} });
/**
* Encoded wire → Err: `{ _tag, data }` resolves against the registry, its
* data codec decodes, and the exact result-rpc TaggedError instance is
* reconstructed. Unknown, private, malformed, or counterfeit tags are issues.
*/
const declaredErrorsFromWire = (definitions) => ({ "~standard": {
	version: 1,
	vendor: "result-rpc",
	validate: (value) => {
		if (value === null || typeof value !== "object" || Array.isArray(value) || !("_tag" in value) || typeof value._tag !== "string") return { issues: [{
			path: [],
			message: "Expected an encoded tagged error"
		}] };
		const definition = definitions.get(value._tag);
		if (definition === void 0 || definition.policy.visibility !== "public") return { issues: [{
			path: ["_tag"],
			message: "Unknown or private error tag"
		}] };
		const reified = definition.decode(value);
		if (!reified.ok) return { issues: toStandardIssues(reified.issues) };
		return { value: reified.value };
	}
} });
/**
* The per-procedure Result codec: Ok values ride the procedure's output wire
* codec, Err values ride its declared error registry.
*/
const procedureResultCodec = (output, definitions) => {
	const errorDefinitions = registry(definitions);
	return Result.codec({
		serialize: {
			ok: encodeSchema(output),
			err: declaredErrorsToWire(errorDefinitions)
		},
		deserialize: {
			ok: decodeSchema(output),
			err: declaredErrorsFromWire(errorDefinitions)
		}
	});
};
//#endregion
export { procedureResultCodec };

//# sourceMappingURL=procedure-result-codec.js.map
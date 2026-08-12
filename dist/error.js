import { err } from "./result.js";
import { wire } from "./wire.js";
import { DEFAULT_MAX_ERROR_BYTES, serialize } from "./serializer.js";
//#region src/error.ts
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
var TaggedError = class TaggedError extends Error {
	_tag;
	data;
	/** Transport eligibility inherited from the definition that created it. */
	visibility;
	constructor(tag, data, visibility, options) {
		const message = data !== null && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : tag;
		super(message, options);
		Object.setPrototypeOf(this, new.target.prototype);
		Object.defineProperty(this, "name", {
			value: tag,
			enumerable: false,
			configurable: true
		});
		this._tag = tag;
		this.data = data;
		this.visibility = visibility;
	}
	/** Returns the canonical prototype-free representation used by the wire. */
	toJSON() {
		return {
			_tag: this._tag,
			data: this.data
		};
	}
	/** Lets a tagged error itself short-circuit a {@link gen} block. */
	*[Symbol.iterator]() {
		yield err(this);
		throw new TypeError("A yielded TaggedError cannot resume");
	}
	/** Checks for a reified result-rpc TaggedError from this package runtime. */
	static is(value) {
		return value instanceof TaggedError;
	}
};
/** Type guard for any reified result-rpc TaggedError. */
const isTaggedError = (value) => TaggedError.is(value);
/** The common HTTP failure vocabulary, usable in place of a numeric status. */
const httpStatusNames = {
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
	"service-unavailable": 503
};
const freezeWireValue = (value, seen = /* @__PURE__ */ new WeakSet()) => {
	if (value !== null && typeof value === "object") {
		if (seen.has(value)) return value;
		seen.add(value);
		Object.freeze(value);
		const children = value instanceof Map ? [...value.entries()].flat() : value instanceof Set ? [...value.values()] : Array.isArray(value) ? value : Object.values(value);
		for (const child of children) {
			if (child === void 0 || child === null || typeof child !== "object") continue;
			freezeWireValue(child, seen);
		}
	}
	return value;
};
const emptyDataCodec = wire.object({});
const createErrorDefinition = (rawOptions, allowReservedNamespace) => {
	const options = {
		...rawOptions,
		data: rawOptions.data,
		httpStatus: rawOptions.visibility === "public" ? typeof rawOptions.httpStatus === "string" ? httpStatusNames[rawOptions.httpStatus] : rawOptions.httpStatus : void 0,
		retry: rawOptions.retry ?? "never",
		visibility: rawOptions.visibility
	};
	if (!options.tag.includes("/")) throw new TypeError(`Error tag must be namespaced: ${options.tag}`);
	if (!allowReservedNamespace && /^(client|server|protocol|control)\//.test(options.tag)) throw new TypeError(`Error tag uses a reserved framework namespace: ${options.tag}`);
	if (options.visibility === "public" && options.httpStatus !== void 0 && (!Number.isInteger(options.httpStatus) || options.httpStatus < 400 || options.httpStatus > 599)) throw new TypeError(`Invalid HTTP error status: ${options.httpStatus}`);
	if (options.visibility === "private" && rawOptions.httpStatus !== void 0) throw new TypeError("Private errors cannot declare an HTTP status");
	class DefinedTaggedError extends TaggedError {
		constructor(data, errorOptions) {
			super(options.tag, data, options.visibility, errorOptions);
			Object.freeze(this);
		}
	}
	const instantiate = (data, errorOptions) => new DefinedTaggedError(freezeWireValue(data), errorOptions);
	const decodeUnsafe = (value) => {
		if (value === null || typeof value !== "object" || Array.isArray(value)) return {
			ok: false,
			issues: [{
				path: [],
				message: "Expected a tagged error object"
			}]
		};
		if (("_tag" in value ? value._tag : void 0) !== options.tag) return {
			ok: false,
			issues: [{
				path: ["_tag"],
				message: `Expected ${options.tag}`
			}]
		};
		const data = "data" in value ? value.data : void 0;
		const decoded = options.data.decode(data);
		if (!decoded.ok) return {
			ok: false,
			issues: decoded.issues.map((issue) => ({
				...issue,
				path: ["data", ...issue.path]
			}))
		};
		const encoded = options.data.encode(decoded.value);
		if (!encoded.ok) return encoded;
		if (!serialize({
			_tag: options.tag,
			data: encoded.value
		}, { maxBytes: 65536 }).ok) return {
			ok: false,
			issues: [{
				path: ["data"],
				message: "Error data is not wire-serializable"
			}]
		};
		return {
			ok: true,
			value: instantiate(encoded.value)
		};
	};
	const decode = (value) => {
		try {
			return decodeUnsafe(value);
		} catch {
			return {
				ok: false,
				issues: [{
					path: ["data"],
					message: "Error data codec failed"
				}]
			};
		}
	};
	const definition = (...args) => {
		let input;
		if (args.length === 0) {
			const decodedDefault = options.data.decode({});
			if (!decodedDefault.ok) {
				const details = decodedDefault.issues.map((issue) => `${issue.path.join(".") || "data"}: ${issue.message}`).join("; ");
				throw new TypeError(`Invalid default data for ${options.tag}: ${details}`);
			}
			input = decodedDefault.value;
		} else input = args[0];
		const errorOptions = args[1];
		const encoded = options.data.encode(input);
		if (!encoded.ok) {
			const details = encoded.issues.map((issue) => `${issue.path.join(".") || "data"}: ${issue.message}`).join("; ");
			throw new TypeError(`Invalid data for ${options.tag}: ${details}`);
		}
		const wireCheck = serialize({
			_tag: options.tag,
			data: encoded.value
		}, { maxBytes: DEFAULT_MAX_ERROR_BYTES });
		if (!wireCheck.ok) throw new TypeError(`Invalid data for ${options.tag}: ${wireCheck.path ?? "data"} is not wire-serializable`);
		return instantiate(encoded.value, errorOptions);
	};
	Object.defineProperties(definition, {
		tag: {
			value: options.tag,
			enumerable: true
		},
		codec: {
			value: options.data,
			enumerable: true
		},
		policy: {
			value: Object.freeze({
				...options.visibility === "public" && options.httpStatus !== void 0 ? { httpStatus: options.httpStatus } : {},
				retry: options.retry,
				visibility: options.visibility,
				...options.severity === void 0 ? {} : { severity: options.severity }
			}),
			enumerable: true
		},
		is: { value: (value) => value instanceof DefinedTaggedError },
		decode: { value: decode }
	});
	return Object.freeze(definition);
};
function error(options) {
	if (options.data === void 0) return createErrorDefinition({
		...options,
		data: emptyDataCodec,
		visibility: options.visibility ?? "public"
	}, false);
	return createErrorDefinition({
		...options,
		data: options.data,
		visibility: options.visibility ?? "public"
	}, false);
}
/** Internal framework factory; intentionally not re-exported from the package root. */
const frameworkError = (options) => createErrorDefinition({
	...options,
	visibility: options.visibility ?? "public"
}, true);
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
const errorCatalog = (definitions, handlers) => {
	const definitionList = Object.values(definitions);
	const tags = new Set(definitionList.map((definition) => definition.tag));
	const definitionsByTag = /* @__PURE__ */ new Map();
	for (const definition of definitionList) {
		const existing = definitionsByTag.get(definition.tag);
		if (existing !== void 0 && existing !== definition) throw new TypeError(`Catalog contains conflicting definitions for tag ${definition.tag}`);
		definitionsByTag.set(definition.tag, definition);
	}
	for (const tag of Object.keys(handlers)) if (!tags.has(tag)) throw new TypeError(`Catalog handles unknown tag ${tag}`);
	for (const tag of tags) if (!(tag in handlers)) throw new TypeError(`Catalog is missing tag ${tag}`);
	const dispatch = (error) => handlers[error._tag](error);
	const catalog = Object.assign(dispatch, { is: (value) => definitionList.some((definition) => definition.is(value)) });
	return Object.freeze(catalog);
};
const kebabCase = (value) => value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
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
const defineErrors = (namespace, specs) => {
	if (namespace.includes("/")) throw new TypeError(`Error namespace must not contain "/": ${namespace}`);
	const definitions = {};
	for (const [key, spec] of Object.entries(specs)) {
		const options = {
			...spec,
			tag: `${namespace}/${kebabCase(key)}`,
			visibility: spec.visibility ?? "public"
		};
		definitions[key] = spec.data === void 0 ? createErrorDefinition({
			...options,
			data: emptyDataCodec
		}, false) : createErrorDefinition({
			...options,
			data: spec.data
		}, false);
	}
	return Object.freeze(definitions);
};
/**
* Selects a subset of an error map, preserving exact definition types. Useful
* when a procedure declares only part of a namespace:
*
*     .errors(pickErrors(todoErrors, "titleTaken", "listFull"))
*/
const pickErrors = (definitions, ...keys) => {
	const picked = {};
	for (const key of keys) {
		const definition = definitions[key];
		if (!definition) throw new TypeError(`Unknown error key ${key}`);
		picked[key] = definition;
	}
	return Object.freeze(picked);
};
//#endregion
export { TaggedError, defineErrors, error, errorCatalog, frameworkError, httpStatusNames, isTaggedError, pickErrors };

//# sourceMappingURL=error.js.map
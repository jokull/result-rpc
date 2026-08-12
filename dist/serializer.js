import { parse, stringify } from "devalue";
import "temporal-polyfill/global";
//#region src/serializer.ts
const SERIALIZER_VERSION = 1;
const DEFAULT_MAX_WIRE_BYTES = 1048576;
const DEFAULT_MAX_ERROR_BYTES = 65536;
const encodedBytes = (value) => new TextEncoder().encode(value).byteLength;
const serialize = (value, options = {}) => {
	try {
		const serialized = stringify(value);
		if (options.maxBytes !== void 0 && encodedBytes(serialized) > options.maxBytes) return {
			ok: false,
			message: `Encoded value exceeds ${options.maxBytes} bytes`
		};
		return {
			ok: true,
			value: serialized
		};
	} catch (cause) {
		const path = cause !== null && typeof cause === "object" && "path" in cause && typeof cause.path === "string" ? cause.path : void 0;
		return {
			ok: false,
			...path === void 0 ? {} : { path },
			message: cause instanceof Error ? cause.message : "Value is not serializable"
		};
	}
};
const deserialize = (value, options = {}) => {
	try {
		if (options.maxBytes !== void 0 && encodedBytes(value) > options.maxBytes) return {
			ok: false,
			message: `Encoded value exceeds ${options.maxBytes} bytes`
		};
		return {
			ok: true,
			value: parse(value)
		};
	} catch (cause) {
		return {
			ok: false,
			message: cause instanceof Error ? cause.message : "Value could not be deserialized"
		};
	}
};
//#endregion
export { DEFAULT_MAX_ERROR_BYTES, DEFAULT_MAX_WIRE_BYTES, SERIALIZER_VERSION, deserialize, serialize };

//# sourceMappingURL=serializer.js.map
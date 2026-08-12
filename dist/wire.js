import { Temporal } from "temporal-polyfill";
//#region src/wire.ts
/** Runtime counterpart of {@link WireValue}, used at untrusted wire boundaries. */
const isWireValue = (value, seen = /* @__PURE__ */ new WeakSet()) => {
	if (value === void 0 || value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return true;
	if (typeof value !== "object") return false;
	if (value instanceof Date || value instanceof RegExp || value instanceof URL || value instanceof URLSearchParams || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
	if (seen.has(value)) return true;
	seen.add(value);
	if (Array.isArray(value)) return value.every((entry) => isWireValue(entry, seen));
	if (value instanceof Map) {
		for (const [key, entry] of value) if (!isWireValue(key, seen) || !isWireValue(entry, seen)) return false;
		return true;
	}
	if (value instanceof Set) {
		for (const entry of value) if (!isWireValue(entry, seen)) return false;
		return true;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	return Object.values(value).every((entry) => isWireValue(entry, seen));
};
/** @internal Dynamic encode after a runtime registry has intentionally erased Input. */
const encodeUnknownWireValue = (codec, input) => codec.encode(input);
function encodeProcedureInput(codec, input) {
	const encoded = encodeUnknownWireValue(codec, input);
	return !encoded.ok && input === void 0 ? encodeUnknownWireValue(codec, {}) : encoded;
}
const success = (value) => ({
	ok: true,
	value
});
const failure = (message, path = []) => ({
	ok: false,
	issues: [{
		path,
		message
	}]
});
/** Canonical array encoding avoids delimiter and object-key-order ambiguity. */
const schemaOf = (...parts) => JSON.stringify(parts);
const scalarSchema = (value) => {
	if (value === void 0) return schemaOf("undefined");
	if (typeof value === "bigint") return schemaOf("bigint", value.toString());
	if (typeof value === "number") {
		if (Number.isNaN(value)) return schemaOf("number", "nan");
		if (value === Infinity) return schemaOf("number", "+infinity");
		if (value === -Infinity) return schemaOf("number", "-infinity");
		if (Object.is(value, -0)) return schemaOf("number", "-0");
	}
	return schemaOf(typeof value, value);
};
const atPath = (issue, segment) => ({
	...issue,
	path: [segment, ...issue.path]
});
const stringCodec = {
	kind: "string",
	schema: schemaOf("string"),
	encode: (input) => typeof input === "string" ? success(input) : failure("Expected a string"),
	decode: (value) => typeof value === "string" ? success(value) : failure("Expected a string")
};
const booleanCodec = {
	kind: "boolean",
	schema: schemaOf("boolean"),
	encode: (input) => typeof input === "boolean" ? success(input) : failure("Expected a boolean"),
	decode: (value) => typeof value === "boolean" ? success(value) : failure("Expected a boolean")
};
const numberCodec = {
	kind: "number",
	schema: schemaOf("number"),
	encode: (input) => typeof input === "number" ? success(input) : failure("Expected a number"),
	decode: (value) => typeof value === "number" ? success(value) : failure("Expected a number")
};
const finiteNumberCodec = {
	kind: "finite-number",
	schema: schemaOf("finite-number"),
	encode: (input) => Number.isFinite(input) ? success(input) : failure("Expected a finite number"),
	decode: (value) => typeof value === "number" && Number.isFinite(value) ? success(value) : failure("Expected a finite number")
};
const bigintCodec = {
	kind: "bigint",
	schema: schemaOf("bigint"),
	encode: (input) => typeof input === "bigint" ? success(input) : failure("Expected a bigint"),
	decode: (value) => typeof value === "bigint" ? success(value) : failure("Expected a bigint")
};
const undefinedCodec = {
	kind: "undefined",
	schema: schemaOf("undefined"),
	encode: (input) => input === void 0 ? success(void 0) : failure("Expected undefined"),
	decode: (value) => value === void 0 ? success(void 0) : failure("Expected undefined")
};
const dateCodec = {
	kind: "date",
	schema: schemaOf("date"),
	encode: (input) => input instanceof Date && !Number.isNaN(input.getTime()) ? success(new Date(input)) : failure("Expected a valid Date"),
	decode: (value) => value instanceof Date && !Number.isNaN(value.getTime()) ? success(new Date(value)) : failure("Expected a valid Date")
};
const regexpCodec = {
	kind: "regexp",
	schema: schemaOf("regexp"),
	encode: (input) => input instanceof RegExp ? success(new RegExp(input.source, input.flags)) : failure("Expected a RegExp"),
	decode: (value) => value instanceof RegExp ? success(new RegExp(value.source, value.flags)) : failure("Expected a RegExp")
};
const urlCodec = {
	kind: "url",
	schema: schemaOf("url"),
	encode: (input) => input instanceof URL ? success(new URL(input)) : failure("Expected a URL"),
	decode: (value) => value instanceof URL ? success(new URL(value)) : failure("Expected a URL")
};
const toPathKey = (key) => typeof key === "number" ? key : String(key);
const isTypedWireValue = (value) => isWireValue(value);
const externalSchemaId = (kind, options) => {
	if (options.id.trim().length === 0) throw new TypeError(`${kind} schema id must not be empty`);
	return options.id;
};
/**
* Adopts a Standard Schema (Valibot, Zod, ArkType, ...) as a wire input
* codec — for teams whose validator is their input vocabulary (the tRPC
* `.input(z.object(...))` habit). Validation runs on both sides of the wire,
* and the validated value must also survive the wire serializer.
*
* Constraints: async schemas are rejected (wire validation is synchronous),
* and the schema must accept its own output — one-way transforms break the
* encode/decode symmetry. This adopts a validator for the WIRE; it does not
* make the input codec a form schema — forms validate humans, wires validate
* applications.
*
* `options.id` is part of the RPC contract fingerprint. Standard Schema does
* not expose a portable structural description, so the application owns this
* stable identifier and must change it whenever the accepted wire shape or
* semantics change.
*/
const standard = (schema, options) => {
	const validate = (value) => {
		let result;
		try {
			result = schema["~standard"].validate(value);
		} catch {
			return failure("Schema validation failed");
		}
		if (result instanceof Promise) return failure("Async schemas are not supported on the wire");
		if (result.issues) return {
			ok: false,
			issues: result.issues.map((issue) => ({
				path: (issue.path ?? []).map((segment) => typeof segment === "object" && segment !== null && "key" in segment ? toPathKey(segment.key) : toPathKey(segment)),
				message: issue.message
			}))
		};
		if (!isTypedWireValue(result.value)) return failure("Expected a value supported by the wire serializer");
		return success(result.value);
	};
	return {
		kind: `standard(${schema["~standard"].vendor})`,
		schema: schemaOf("standard", schema["~standard"].vendor, externalSchemaId("Standard Schema", options)),
		encode: (input) => validate(input),
		decode: validate
	};
};
/**
* Adopts a guarded rich wire value. `options.id` is its stable contract schema
* identity and must change whenever the guard's accepted shape changes.
*/
const serializable = (guard, options) => ({
	kind: "serializable",
	schema: schemaOf("serializable", externalSchemaId("Serializable", options)),
	encode: (input) => guard(input) && isWireValue(input) ? success(input) : failure("Expected a validated value supported by the wire serializer"),
	decode: (value) => guard(value) && isWireValue(value) ? success(value) : failure("Expected a validated value supported by the wire serializer")
});
/**
* A transformation codec: the application value differs from the wire value.
*
* Built-ins cover values the wire serializer carries natively (Date, RegExp,
* URL). `codec` is for everything else — a value that must travel as one of
* its projections and be restored on the other side. The canonical example is
* a calendar date: the domain speaks `Temporal.PlainDate`, the wire speaks
* `"2026-08-07"`.
*
* ```ts
* const plainDateCodec = wire.codec({
*   id: "calendar-date/plain-date:v1",
*   wire: wire.string,
*   encode: (date: Temporal.PlainDate) => success(date.toString()),
*   decode: (value) => success(Temporal.PlainDate.from(value)),
* });
* ```
*
* The factory composes through the declared `wire` codec on both sides: an
* encoded value that fails the wire codec is rejected before it reaches the
* serializer, and an incoming value the wire codec rejects never reaches the
* custom decoder. The digest is `codec(<id>, <wire schema>)`, so the contract
* fingerprint changes if either the identity or the wire shape changes.
*/
const codec = (options) => ({
	kind: `codec(${options.wire.kind})`,
	schema: schemaOf("codec", externalSchemaId("codec", options), options.wire.schema),
	encode: (input) => {
		const encoded = options.encode(input);
		if (!encoded.ok) return encoded;
		return options.wire.encode(encoded.value);
	},
	decode: (value) => {
		const decoded = options.wire.decode(value);
		if (!decoded.ok) return decoded;
		return options.decode(decoded.value);
	}
});
/**
* A Temporal value projected to its canonical string on the wire and rebuilt
* with `Temporal.X.from` on the other side. `from` may throw for a valid
* string that is not a valid value of the type, so decode guards the call.
*/
const temporalString = (name, id, isInstance, from, to) => codec({
	id,
	wire: stringCodec,
	encode: (input) => isInstance(input) ? success(to(input)) : failure(`Expected a Temporal.${name} value`),
	decode: (value) => {
		try {
			return success(from(value));
		} catch {
			return failure(`Expected a valid Temporal.${name} value`);
		}
	}
});
/**
* The Temporal suite: every calendar- and clock-oriented Temporal class,
* carried on the wire as its canonical ISO string and restored with
* `Temporal.X.from`. `Temporal.TimeZone` and `Temporal.Calendar` are
* identifier strings in the spec, so they travel as plain `wire.string`.
*/
const temporalWire = {
	plainDate: temporalString("PlainDate", "temporal/plain-date:v1", (value) => value instanceof Temporal.PlainDate, (wire) => Temporal.PlainDate.from(wire), (value) => value.toString()),
	plainDateTime: temporalString("PlainDateTime", "temporal/plain-date-time:v1", (value) => value instanceof Temporal.PlainDateTime, (wire) => Temporal.PlainDateTime.from(wire), (value) => value.toString()),
	plainTime: temporalString("PlainTime", "temporal/plain-time:v1", (value) => value instanceof Temporal.PlainTime, (wire) => Temporal.PlainTime.from(wire), (value) => value.toString()),
	plainYearMonth: temporalString("PlainYearMonth", "temporal/plain-year-month:v1", (value) => value instanceof Temporal.PlainYearMonth, (wire) => Temporal.PlainYearMonth.from(wire), (value) => value.toString()),
	plainMonthDay: temporalString("PlainMonthDay", "temporal/plain-month-day:v1", (value) => value instanceof Temporal.PlainMonthDay, (wire) => Temporal.PlainMonthDay.from(wire), (value) => value.toString()),
	instant: temporalString("Instant", "temporal/instant:v1", (value) => value instanceof Temporal.Instant, (wire) => Temporal.Instant.from(wire), (value) => value.toString()),
	zonedDateTime: temporalString("ZonedDateTime", "temporal/zoned-date-time:v1", (value) => value instanceof Temporal.ZonedDateTime, (wire) => Temporal.ZonedDateTime.from(wire), (value) => value.toString()),
	duration: temporalString("Duration", "temporal/duration:v1", (value) => value instanceof Temporal.Duration, (wire) => Temporal.Duration.from(wire), (value) => value.toString())
};
const nullCodec = {
	kind: "null",
	schema: schemaOf("null"),
	encode: (input) => input === null ? success(null) : failure("Expected null"),
	decode: (value) => value === null ? success(null) : failure("Expected null")
};
const integer = (options = {}) => ({
	kind: "integer",
	schema: schemaOf("integer", options.min ?? null, options.max ?? null),
	encode: (input) => validateInteger(input, options),
	decode: (value) => validateInteger(value, options)
});
const validateInteger = (value, options) => {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) return failure("Expected a safe integer");
	if (options.min !== void 0 && value < options.min) return failure(`Expected an integer greater than or equal to ${options.min}`);
	if (options.max !== void 0 && value > options.max) return failure(`Expected an integer less than or equal to ${options.max}`);
	return success(value);
};
const literal = (expected) => ({
	kind: "literal",
	schema: schemaOf("literal", scalarSchema(expected)),
	encode: (input) => Object.is(input, expected) ? success(input) : failure(`Expected ${String(expected)}`),
	decode: (value) => Object.is(value, expected) ? success(expected) : failure(`Expected ${String(expected)}`)
});
const isEnumValue = (values, value) => typeof value === "string" && values.some((candidate) => candidate === value);
/** A string literal union with the same contract identity as its expanded form. */
const enumCodec = (values) => ({
	kind: "union",
	schema: schemaOf("union", values.map((value) => literal(value).schema)),
	encode: (input) => isEnumValue(values, input) ? success(input) : failure(`Expected one of: ${values.join(", ")}`),
	decode: (value) => isEnumValue(values, value) ? success(value) : failure(`Expected one of: ${values.join(", ")}`)
});
const array = (item) => ({
	kind: "array",
	schema: schemaOf("array", item.schema),
	encode: (input) => {
		if (!Array.isArray(input)) return failure("Expected an array");
		const output = [];
		const issues = [];
		input.forEach((value, index) => {
			const result = item.encode(value);
			if (result.ok) output.push(result.value);
			else issues.push(...result.issues.map((issue) => atPath(issue, index)));
		});
		return issues.length > 0 ? {
			ok: false,
			issues
		} : success(output);
	},
	decode: (value) => {
		if (!Array.isArray(value)) return failure("Expected an array");
		const output = [];
		const issues = [];
		value.forEach((entry, index) => {
			const result = item.decode(entry);
			if (result.ok) output.push(result.value);
			else issues.push(...result.issues.map((issue) => atPath(issue, index)));
		});
		return issues.length > 0 ? {
			ok: false,
			issues
		} : success(output);
	}
});
const union = (codecs) => ({
	kind: "union",
	schema: schemaOf("union", codecs.map((codec) => codec.schema)),
	encode: (input) => {
		for (const codec of codecs) {
			const result = encodeUnknownWireValue(codec, input);
			if (result.ok) return result;
		}
		return failure("Value did not match any union member");
	},
	decode: (value) => {
		for (const codec of codecs) {
			const result = codec.decode(value);
			if (result.ok) return result;
		}
		return failure("Value did not match any union member");
	}
});
const optional = (codec) => ({
	kind: `optional(${codec.kind})`,
	schema: schemaOf("optional", codec.schema),
	optional: true,
	encode: (input) => input === void 0 ? success(void 0) : codec.encode(input),
	decode: (value) => value === void 0 ? success(void 0) : codec.decode(value)
});
const record = (codec) => ({
	kind: `record(${codec.kind})`,
	schema: schemaOf("record", codec.schema),
	encode: (input) => processRecord(input, codec, "encode"),
	decode: (value) => processRecord(value, codec, "decode")
});
function processRecord(value, codec, direction) {
	if (!isPlainObject(value)) return failure("Expected a plain object record");
	const output = Object.create(null);
	const issues = [];
	for (const [key, entry] of Object.entries(value)) {
		const result = direction === "encode" ? codec.encode(entry) : codec.decode(entry);
		if (result.ok) Object.defineProperty(output, key, {
			value: result.value,
			enumerable: true,
			configurable: true,
			writable: true
		});
		else issues.push(...result.issues.map((issue) => atPath(issue, key)));
	}
	return issues.length > 0 ? {
		ok: false,
		issues
	} : success(output);
}
const isPlainObject = (value) => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};
const object = (shape) => ({
	kind: "object",
	schema: schemaOf("object", Object.entries(shape).sort(([left], [right]) => left.localeCompare(right)).map(([key, codec]) => [key, codec.schema])),
	encode: (input) => {
		return processObject(input, shape, "encode");
	},
	decode: (value) => {
		return processObject(value, shape, "decode");
	}
});
const processObject = (value, shape, direction) => {
	if (!isPlainObject(value)) return failure("Expected a plain object");
	const allowedKeys = new Set(Object.keys(shape));
	const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
	if (unknownKeys.length > 0) return {
		ok: false,
		issues: unknownKeys.map((key) => ({
			path: [key],
			message: "Unknown property"
		}))
	};
	const output = {};
	const issues = [];
	for (const [key, codec] of Object.entries(shape)) {
		if (!(key in value) && "optional" in codec && codec.optional === true) continue;
		const result = direction === "encode" ? encodeUnknownWireValue(codec, value[key]) : codec.decode(value[key]);
		if (result.ok) Object.defineProperty(output, key, {
			value: result.value,
			enumerable: true,
			configurable: true,
			writable: true
		});
		else issues.push(...result.issues.map((issue) => atPath(issue, key)));
	}
	return issues.length > 0 ? {
		ok: false,
		issues
	} : success(output);
};
const wire = {
	string: stringCodec,
	boolean: booleanCodec,
	number: numberCodec,
	finiteNumber: finiteNumberCodec,
	bigint: bigintCodec,
	undefined: undefinedCodec,
	date: dateCodec,
	regexp: regexpCodec,
	url: urlCodec,
	null: nullCodec,
	nullable: (codec) => union([codec, nullCodec]),
	integer,
	literal,
	enum: enumCodec,
	array,
	union,
	optional,
	record,
	object,
	serializable,
	codec,
	temporal: temporalWire,
	standard
};
//#endregion
export { encodeProcedureInput, encodeUnknownWireValue, failure, isWireValue, success, temporalWire, wire };

//# sourceMappingURL=wire.js.map
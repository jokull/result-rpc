import { wire } from "./wire.js";
//#region src/model.ts
/** Decoded-entity brands: object identity → its model. Global and inert. */
const entityBrands = /* @__PURE__ */ new WeakMap();
/** @internal Runtime proof used by cache projection adapters. */
const isEntityRecord = (value) => {
	if (value === null || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};
const isWireCodec = (value) => value !== null && typeof value === "object" && typeof Reflect.get(value, "kind") === "string" && typeof Reflect.get(value, "encode") === "function" && typeof Reflect.get(value, "decode") === "function";
/** Internal: read a decoded object's model, if any. */
const entityBrandOf = (value) => entityBrands.get(value);
const ENTITY_ID_PREFIX = "result-rpc:entity:1:";
/**
* ECMAScript's finite-number string form is a canonical round-trippable
* representation. The four non-finite/signed-zero cases need explicit names
* so every value distinguished by `Object.is` has stable identity semantics.
*/
const encodeIdentityNumber = (value) => {
	if (Number.isNaN(value)) return "NaN";
	if (value === Number.POSITIVE_INFINITY) return "+Infinity";
	if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
	if (Object.is(value, -0)) return "-0";
	return String(value);
};
const encodeIdentityPart = (value) => typeof value === "string" ? ["s", value] : ["n", encodeIdentityNumber(value)];
/**
* One encoder owns the complete cache identity. JSON array encoding is
* injective here because every segment is a tagged two-tuple: model name,
* scalar type, arity, empty strings, Unicode, and delimiter characters all
* retain explicit boundaries.
*/
const encodeEntityIdentity = (model, parts) => {
	const encoded = JSON.stringify([encodeIdentityPart(model.name), ...parts.map(encodeIdentityPart)]);
	return `${ENTITY_ID_PREFIX}${encoded}`;
};
const isCanonicalEncodedNumber = (value) => {
	if (value === "NaN" || value === "+Infinity" || value === "-Infinity" || value === "-0") return true;
	const number = Number(value);
	return Number.isFinite(number) && String(number) === value;
};
const isEncodedIdentityPart = (value) => {
	if (!Array.isArray(value) || value.length !== 2 || typeof value[1] !== "string") return false;
	return value[0] === "s" || value[0] === "n" && isCanonicalEncodedNumber(value[1]);
};
const encodedIdentityModelName = (value) => {
	if (!value.startsWith(ENTITY_ID_PREFIX)) return void 0;
	let parsed;
	try {
		parsed = JSON.parse(value.slice(20));
	} catch {
		return;
	}
	if (!Array.isArray(parsed) || parsed.length < 2 || !parsed.every(isEncodedIdentityPart)) return;
	const model = parsed[0];
	return model?.[0] === "s" ? model[1] : void 0;
};
/** @internal Reads a canonical, model-qualified id from a decoded entity. */
const entityIdOf = (value, model) => {
	const parts = [];
	for (const field of model.keyFields) {
		const raw = Reflect.get(value, field);
		if (typeof raw !== "string" && typeof raw !== "number") return void 0;
		parts.push(raw);
	}
	return encodeEntityIdentity(model, parts);
};
/**
* Resolves a caller-supplied key to the entity's opaque canonical id. Records
* must carry every key field. A bare scalar addresses only a single-field
* key; composite keys require their structured record, so segment boundaries
* cannot be guessed from a pre-joined string.
*/
const entityIdFor = (model, id) => {
	if (typeof id === "string" || typeof id === "number") return model.keyFields.length === 1 ? encodeEntityIdentity(model, [id]) : void 0;
	return entityIdOf(id, model);
};
/**
* Converts an entity id to the internal cache-index key while checking the
* model qualification. All cache keys therefore originate in the same full
* tuple encoder; no caller may recreate one with string concatenation.
*/
const entityKey = (model, id) => {
	if (encodedIdentityModelName(id) !== model) throw new TypeError(`Entity id is not the canonical identity for model ${JSON.stringify(model)}`);
	return id;
};
/** @internal Validates a model-qualified cache key received over the wire. */
const entityCacheKeyFromWire = (value) => encodedIdentityModelName(value) === void 0 ? void 0 : value;
const brandingCodec = (inner, kind, model) => ({
	kind,
	schema: JSON.stringify([
		"model",
		kind,
		inner.schema
	]),
	encode: (input) => inner.encode(input),
	decode: (value) => {
		const result = inner.decode(value);
		if (result.ok && result.value !== null && typeof result.value === "object") entityBrands.set(result.value, model());
		return result;
	}
});
function normalizeModelKey(key) {
	return typeof key === "string" ? [key] : key;
}
const defineModel = (name, options) => {
	const keyFields = normalizeModelKey(options.key);
	if (keyFields.length === 0) throw new TypeError(`Model ${name} declares an empty key`);
	for (const field of keyFields) if (!(field in options.shape)) throw new TypeError(`Model ${name} declares key "${field}" but the shape has no such field`);
	let self;
	const requireKeyFields = (selected, what) => {
		for (const field of keyFields) if (!selected.includes(field)) throw new TypeError(`Model ${name} ${what} must include its key "${field}" — an entity without its identity is just data`);
	};
	const select = (selection) => {
		const keys = Object.keys(selection);
		const own = keys.filter((key) => Reflect.get(selection, key) === true);
		requireKeyFields(own, "selection");
		const subset = {};
		for (const key of keys) {
			const value = Reflect.get(selection, key);
			if (value === true) {
				const codec = options.shape[key];
				if (!codec) throw new TypeError(`Model ${name} has no field "${key}" — select true only for the model's own fields, or give a codec`);
				subset[key] = codec;
			} else {
				if (!isWireCodec(value)) throw new TypeError(`Model ${name} selection "${key}" must be true or a wire codec`);
				subset[key] = value;
			}
		}
		return brandingCodec(wire.object(subset), `model(${name}):{${[...keys].sort().join(",")}}`, () => self);
	};
	const pick = (...keys) => {
		requireKeyFields(keys, "projection");
		const subset = {};
		for (const key of keys) subset[key] = options.shape[key];
		return brandingCodec(wire.object(subset), `model(${name}):${[...keys].sort().join(",")}`, () => self);
	};
	const definition = {
		$model: true,
		name,
		key: options.key,
		keyFields,
		$satisfies: () => self,
		all: (reason) => {
			if (typeof reason !== "string" || reason.trim().length === 0) throw new TypeError(`Model ${name}: all() ships every field, so it takes a reason — say why this output is allowed to widen with the model`);
			return brandingCodec(wire.object(options.shape), `model(${name}):all`, () => self);
		},
		select,
		pick
	};
	self = definition;
	return Object.freeze(definition);
};
/**
* Walks a decoded value for branded entity objects. Cycle-safe; shared
* references collect once. Used by the query runtime on cached query data
* and on mutation outputs — never on the server.
*/
const collectEntities = (root) => {
	const found = [];
	const seen = /* @__PURE__ */ new WeakSet();
	const visit = (value) => {
		if (value === null || typeof value !== "object") return;
		if (seen.has(value)) return;
		seen.add(value);
		const model = entityBrands.get(value);
		if (model) {
			const id = entityIdOf(value, model);
			if (id !== void 0 && isEntityRecord(value)) found.push({
				model,
				id,
				value
			});
		}
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (value instanceof Map) {
			for (const [key, item] of value.entries()) {
				visit(key);
				visit(item);
			}
			return;
		}
		if (value instanceof Set) {
			for (const item of value.values()) visit(item);
			return;
		}
		if (Object.getPrototypeOf(value) === Object.prototype || model) for (const item of Object.values(value)) visit(item);
	};
	visit(root);
	return found;
};
/**
* The projection rule: merge only the keys the cached object already has.
* One model, one field vocabulary; projections are subsets — so overlapping
* keys are type-compatible by contract, and fields the source doesn't carry
* stay as they were. Returns the original object when nothing changes.
*/
const mergeByExistingKeys = (current, fresh) => {
	let changed = false;
	const next = {};
	for (const [key, value] of Object.entries(current)) if (key in fresh && !Object.is(fresh[key], value)) {
		next[key] = fresh[key];
		changed = true;
	} else next[key] = value;
	return changed ? next : current;
};
/**
* Replaces every occurrence of the identified entity inside a decoded value,
* by identity match on branded objects. Clones the containers along the way
* (cycle-safe, shared references preserved, brands carried onto clones);
* returns the original root untouched when no occurrence changed.
*/
const patchEntity = (root, model, id, produce) => {
	let changed = false;
	const clones = /* @__PURE__ */ new WeakMap();
	const walk = (value) => {
		if (value === null || typeof value !== "object") return value;
		const cached = clones.get(value);
		if (cached !== void 0) return cached;
		const brand = entityBrands.get(value);
		if (brand === model && entityIdOf(value, brand) === id && isEntityRecord(value)) {
			const produced = produce(value);
			const next = {};
			clones.set(value, next);
			entityBrands.set(next, brand);
			if (produced !== value) changed = true;
			for (const [key, item] of Object.entries(produced)) next[key] = walk(item);
			return next;
		}
		if (Array.isArray(value)) {
			const next = [];
			clones.set(value, next);
			for (const item of value) next.push(walk(item));
			return next;
		}
		if (value instanceof Map) {
			const next = /* @__PURE__ */ new Map();
			clones.set(value, next);
			for (const [key, item] of value.entries()) next.set(walk(key), walk(item));
			return next;
		}
		if (value instanceof Set) {
			const next = /* @__PURE__ */ new Set();
			clones.set(value, next);
			for (const item of value.values()) next.add(walk(item));
			return next;
		}
		if (Object.getPrototypeOf(value) === Object.prototype || brand !== void 0) {
			const next = {};
			clones.set(value, next);
			if (brand !== void 0) entityBrands.set(next, brand);
			for (const [key, item] of Object.entries(value)) next[key] = walk(item);
			return next;
		}
		clones.set(value, value);
		return value;
	};
	const value = walk(root);
	return changed ? {
		value,
		changed
	} : {
		value: root,
		changed
	};
};
/**
* Brand-preserving structural sharing — installed as the query cache's
* `structuralSharing` so it runs on EVERY write path into cached data.
*
* Same reference-reuse semantics as query-core's `replaceEqualDeep` (equal
* subtrees keep their old identity; changed plain containers become mixed
* copies), with one addition that the whole entity system depends on: brands
* live in a WeakMap keyed on object identity, and the default merge
* manufactures identity-fresh copies that silently fall out of the entity
* index. This variant transfers brands onto whatever object survives:
*
* - the incoming side is branded → the result (retained old object, mixed
*   copy, or the new object itself) carries that brand. Branding the RETAINED
*   old object is what makes SSR hydration work — the observe-time re-decode
*   deep-equals the hydrated value, the old object is kept, and it inherits
*   the decode pass's brand.
* - only the OLD side is branded (an app updater spread an entity) → the
*   brand carries over iff the model's key field still matches, so a spread
*   in an `optimistic:` block no longer silently disables entity patching.
*/
const shareStructural = (previous, next) => {
	const visiting = /* @__PURE__ */ new Set();
	const share = (a, b) => {
		if (Object.is(a, b)) return a;
		if (b === null || typeof b !== "object") return b;
		const bBrand = entityBrands.get(b);
		const finish = (result) => {
			if (result !== null && typeof result === "object") {
				if (bBrand) entityBrands.set(result, bBrand);
				else if (!Object.is(result, a) && a !== null && typeof a === "object") {
					const aBrand = entityBrands.get(a);
					if (aBrand) {
						const previousId = entityIdOf(a, aBrand);
						const resultId = entityIdOf(result, aBrand);
						if (previousId !== void 0 && previousId === resultId) entityBrands.set(result, aBrand);
					}
				}
			}
			return result;
		};
		const aIsArray = Array.isArray(a);
		const bIsArray = Array.isArray(b);
		if (aIsArray && bIsArray) {
			if (visiting.has(b)) return b;
			visiting.add(b);
			const copy = Array.from({ length: b.length });
			let equal = 0;
			for (let index = 0; index < b.length; index += 1) {
				copy[index] = share(a[index], b[index]);
				if (index < a.length && Object.is(copy[index], a[index])) equal += 1;
			}
			visiting.delete(b);
			return finish(a.length === b.length && equal === b.length ? a : copy);
		}
		if (!aIsArray && !bIsArray && a !== null && typeof a === "object" && Object.getPrototypeOf(a) === Object.prototype && Object.getPrototypeOf(b) === Object.prototype) {
			if (visiting.has(b)) return b;
			visiting.add(b);
			const bKeys = Object.keys(b);
			const copy = {};
			let equal = 0;
			for (const key of bKeys) {
				const previousValue = Reflect.get(a, key);
				copy[key] = share(previousValue, Reflect.get(b, key));
				if (key in a && Object.is(copy[key], previousValue)) equal += 1;
			}
			visiting.delete(b);
			return finish(Object.keys(a).length === bKeys.length && equal === bKeys.length ? a : copy);
		}
		return finish(b);
	};
	return share(previous, next);
};
//#endregion
export { collectEntities, defineModel, entityBrandOf, entityCacheKeyFromWire, entityIdFor, entityIdOf, entityKey, isEntityRecord, mergeByExistingKeys, patchEntity, shareStructural };

//# sourceMappingURL=model.js.map
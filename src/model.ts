import {
  wire,
  type CodecShape,
  type ShapeInput,
  type WireCodec,
  type WireValue,
} from "./wire.js";

/**
 * Entity identities: the graph over the denormalized cache.
 *
 * A model is to values what an error definition is to failures — a named,
 * shared declaration. `defineModel(name, { key, shape })` yields a wire codec
 * whose decode pass *brands* every decoded entity object (a global WeakMap;
 * race-free, inert on the server, garbage-collected with the values). The
 * query runtime later walks decoded results for branded objects to maintain
 * an entity → queries index, and patches cached values in place by identity.
 *
 * There are no recorded paths: patching re-walks the cached value and
 * replaces matching branded objects wherever they appear — which makes
 * shared references, cycles, and Map/Set members behave uniformly.
 */

export interface ModelDefinition<
  TName extends string = string,
  TShape extends CodecShape = CodecShape,
> {
  readonly $model: true;
  readonly name: TName;
  /** The identity field(s) as declared; present in the canonical shape and every pick. */
  readonly key: string | readonly string[];
  /** The identity fields, normalized. Composite keys join values in this order. */
  readonly keyFields: readonly string[];
  /** The canonical codec: the full shape, identity-collecting on decode. */
  readonly codec: WireCodec<ShapeInput<TShape>, WireValue>;
  /**
   * A projection codec — a subset of the shape, still identity-collecting.
   * The key field is mandatory: an entity without its identity is just data.
   */
  pick<const TKeys extends readonly (keyof TShape & string)[]>(
    ...keys: TKeys
  ): WireCodec<ShapeInput<Pick<TShape, TKeys[number]>>, WireValue>;
}

export type AnyModel = ModelDefinition<string, CodecShape>;

export type ModelValue<TModel> = TModel extends ModelDefinition<string, infer TShape>
  ? ShapeInput<TShape>
  : never;

export interface DefineModelOptions<TShape extends CodecShape> {
  /**
   * The field(s) carrying the identity (string or number values). A composite
   * key — e.g. `["id", "locale"]` for content that varies per locale under
   * one id — makes each combination its OWN entity: patching the `en`
   * variant never touches the `ja` variant.
   */
  readonly key: (keyof TShape & string) | readonly (keyof TShape & string)[];
  readonly shape: TShape;
}

/** How callers address an entity: a plain id, a pre-joined composite id, or the key fields. */
export type ModelKeyInput = string | number | Readonly<Record<string, string | number>>;

/** Decoded-entity brands: object identity → its model. Global and inert. */
const entityBrands = new WeakMap<object, AnyModel>();

/** Internal: read a decoded object's model, if any. */
export const entityBrandOf = (value: object): AnyModel | undefined =>
  entityBrands.get(value);

/** Internal: brand a value produced outside decode (patched/merged objects). */
export const brandEntity = (value: object, model: AnyModel): void => {
  entityBrands.set(value, model);
};

const entityIdOf = (value: object, model: AnyModel): string | undefined => {
  const parts: string[] = [];
  for (const field of model.keyFields) {
    const raw = (value as Record<string, unknown>)[field];
    if (typeof raw !== "string" && typeof raw !== "number") return undefined;
    parts.push(String(raw));
  }
  return parts.join(":");
};

/**
 * Resolves a caller-supplied key to the entity's id string. Records must
 * carry every key field; a bare string/number addresses single-field keys
 * (or is taken as a pre-joined composite id).
 */
export const entityIdFor = (
  model: AnyModel,
  id: ModelKeyInput,
): string | undefined => {
  if (typeof id === "string" || typeof id === "number") return String(id);
  return entityIdOf(id as object, model);
};

export const entityKey = (model: string, id: string): string => `${model}:${id}`;

const brandingCodec = <TValue>(
  inner: WireCodec<TValue, WireValue>,
  kind: string,
  model: () => AnyModel,
): WireCodec<TValue, WireValue> => ({
  kind,
  encode: (input) => inner.encode(input),
  decode: (value) => {
    const result = inner.decode(value);
    if (result.ok && result.value !== null && typeof result.value === "object") {
      entityBrands.set(result.value as object, model());
    }
    return result;
  },
});

export const defineModel = <
  const TName extends string,
  const TShape extends CodecShape,
>(
  name: TName,
  options: DefineModelOptions<TShape>,
): ModelDefinition<TName, TShape> => {
  const keyFields: readonly string[] = typeof options.key === "string"
    ? [options.key]
    : options.key;
  if (keyFields.length === 0) {
    throw new TypeError(`Model ${name} declares an empty key`);
  }
  for (const field of keyFields) {
    if (!(field in options.shape)) {
      throw new TypeError(`Model ${name} declares key "${field}" but the shape has no such field`);
    }
  }
  let self: ModelDefinition<TName, TShape>;
  const definition: ModelDefinition<TName, TShape> = {
    $model: true,
    name,
    key: options.key,
    keyFields,
    codec: brandingCodec(
      wire.object(options.shape) as WireCodec<ShapeInput<TShape>, WireValue>,
      `model(${name})`,
      () => self as AnyModel,
    ),
    pick: (...keys) => {
      for (const field of keyFields) {
        if (!keys.includes(field as (typeof keys)[number])) {
          throw new TypeError(
            `Model ${name} projection must include its key "${field}" — an entity without its identity is just data`,
          );
        }
      }
      const subset: Record<string, WireCodec<unknown, WireValue>> = {};
      for (const key of keys) subset[key] = options.shape[key]!;
      return brandingCodec(
        wire.object(subset) as WireCodec<ShapeInput<Pick<TShape, (typeof keys)[number]>>, WireValue>,
        `model(${name}):${[...keys].sort().join(",")}`,
        () => self as AnyModel,
      );
    },
  };
  self = definition;
  return Object.freeze(definition);
};

// --- Collection --------------------------------------------------------------

export interface CollectedEntity {
  readonly model: AnyModel;
  readonly id: string;
  /** The decoded (projection-shaped) entity object. */
  readonly value: Record<string, unknown>;
}

/**
 * Walks a decoded value for branded entity objects. Cycle-safe; shared
 * references collect once. Used by the query runtime on cached query data
 * and on mutation outputs — never on the server.
 */
export const collectEntities = (root: unknown): readonly CollectedEntity[] => {
  const found: CollectedEntity[] = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    const model = entityBrands.get(value);
    if (model) {
      const id = entityIdOf(value, model);
      if (id !== undefined) {
        found.push({ model, id, value: value as Record<string, unknown> });
      }
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
    if (Object.getPrototypeOf(value) === Object.prototype || model) {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(root);
  return found;
};

// --- Patching ----------------------------------------------------------------

/**
 * The projection rule: merge only the keys the cached object already has.
 * One model, one field vocabulary; projections are subsets — so overlapping
 * keys are type-compatible by contract, and fields the source doesn't carry
 * stay as they were. Returns the original object when nothing changes.
 */
export const mergeByExistingKeys = (
  current: Record<string, unknown>,
  fresh: Record<string, unknown>,
): Record<string, unknown> => {
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (key in fresh && !Object.is(fresh[key], value)) {
      next[key] = fresh[key];
      changed = true;
    } else {
      next[key] = value;
    }
  }
  return changed ? next : current;
};

/**
 * Replaces every occurrence of the identified entity inside a decoded value,
 * by identity match on branded objects. Clones the containers along the way
 * (cycle-safe, shared references preserved, brands carried onto clones);
 * returns the original root untouched when no occurrence changed.
 */
export const patchEntity = (
  root: unknown,
  model: AnyModel,
  id: string,
  produce: (current: Record<string, unknown>) => Record<string, unknown>,
): { readonly value: unknown; readonly changed: boolean } => {
  let changed = false;
  const clones = new WeakMap<object, unknown>();
  const walk = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    const cached = clones.get(value);
    if (cached !== undefined) return cached;
    const brand = entityBrands.get(value);
    if (brand === model && entityIdOf(value, brand) === id) {
      // Walk INTO the produced replacement: a nested occurrence of the same
      // entity (including a self-reference cycle) must be patched too, and
      // cycles must rebind to the clone, not dangle on the original.
      const produced = produce(value as Record<string, unknown>);
      const next: Record<string, unknown> = {};
      clones.set(value, next);
      entityBrands.set(next, brand);
      if (produced !== value) changed = true;
      for (const [key, item] of Object.entries(produced)) next[key] = walk(item);
      return next;
    }
    if (Array.isArray(value)) {
      const next: unknown[] = [];
      clones.set(value, next);
      for (const item of value) next.push(walk(item));
      return next;
    }
    if (value instanceof Map) {
      const next = new Map<unknown, unknown>();
      clones.set(value, next);
      for (const [key, item] of value.entries()) next.set(walk(key), walk(item));
      return next;
    }
    if (value instanceof Set) {
      const next = new Set<unknown>();
      clones.set(value, next);
      for (const item of value.values()) next.add(walk(item));
      return next;
    }
    if (Object.getPrototypeOf(value) === Object.prototype || brand !== undefined) {
      const next: Record<string, unknown> = {};
      clones.set(value, next);
      if (brand !== undefined) entityBrands.set(next, brand);
      for (const [key, item] of Object.entries(value)) next[key] = walk(item);
      return next;
    }
    // rich leaves (Date, URL, typed arrays, ...) pass through by reference
    clones.set(value, value);
    return value;
  };
  const value = walk(root);
  return changed ? { value, changed } : { value: root, changed };
};

// --- Structural sharing --------------------------------------------------------

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
export const shareStructural = (previous: unknown, next: unknown): unknown => {
  const visiting = new Set<object>();
  const share = (a: unknown, b: unknown): unknown => {
    if (Object.is(a, b)) return a;
    if (b === null || typeof b !== "object") return b;
    const bBrand = entityBrands.get(b);
    const finish = (result: unknown): unknown => {
      if (result !== null && typeof result === "object") {
        if (bBrand) {
          entityBrands.set(result, bBrand);
        } else if (!Object.is(result, a) && a !== null && typeof a === "object") {
          const aBrand = entityBrands.get(a);
          if (aBrand) {
            const previousId = entityIdOf(a, aBrand);
            const resultId = entityIdOf(result as object, aBrand);
            if (previousId !== undefined && previousId === resultId) {
              entityBrands.set(result, aBrand);
            }
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
      const aArray = a as readonly unknown[];
      const bArray = b as readonly unknown[];
      const copy: unknown[] = new Array(bArray.length);
      let equal = 0;
      for (let index = 0; index < bArray.length; index += 1) {
        copy[index] = share(aArray[index], bArray[index]);
        if (index < aArray.length && Object.is(copy[index], aArray[index])) equal += 1;
      }
      visiting.delete(b);
      return finish(
        aArray.length === bArray.length && equal === bArray.length ? a : copy,
      );
    }
    if (
      !aIsArray && !bIsArray
      && a !== null && typeof a === "object"
      && Object.getPrototypeOf(a) === Object.prototype
      && Object.getPrototypeOf(b) === Object.prototype
    ) {
      if (visiting.has(b)) return b;
      visiting.add(b);
      const aObject = a as Record<string, unknown>;
      const bObject = b as Record<string, unknown>;
      const bKeys = Object.keys(bObject);
      const copy: Record<string, unknown> = {};
      let equal = 0;
      for (const key of bKeys) {
        copy[key] = share(aObject[key], bObject[key]);
        if (key in aObject && Object.is(copy[key], aObject[key])) equal += 1;
      }
      visiting.delete(b);
      return finish(
        Object.keys(aObject).length === bKeys.length && equal === bKeys.length
          ? a
          : copy,
      );
    }
    // Rich values (Date, Map, Set, URL, ...), type mismatches, and fresh
    // subtrees take the new side wholesale — its interior is already branded
    // by the decode or patch that produced it.
    return finish(b);
  };
  return share(previous, next);
};

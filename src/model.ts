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
  /** The identity field; present in the canonical shape and every pick. */
  readonly key: string;
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
  /** The field carrying the identity (a string or number value). */
  readonly key: keyof TShape & string;
  readonly shape: TShape;
}

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
  const raw = (value as Record<string, unknown>)[model.key];
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : undefined;
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
  if (!(options.key in options.shape)) {
    throw new TypeError(`Model ${name} declares key "${options.key}" but the shape has no such field`);
  }
  let self: ModelDefinition<TName, TShape>;
  const definition: ModelDefinition<TName, TShape> = {
    $model: true,
    name,
    key: options.key,
    codec: brandingCodec(
      wire.object(options.shape) as WireCodec<ShapeInput<TShape>, WireValue>,
      `model(${name})`,
      () => self as AnyModel,
    ),
    pick: (...keys) => {
      if (!keys.includes(options.key as (typeof keys)[number])) {
        throw new TypeError(
          `Model ${name} projection must include its key "${options.key}" — an entity without its identity is just data`,
        );
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
      for (const item of value.values()) visit(item);
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
      const next = produce(value as Record<string, unknown>);
      if (next !== value) {
        entityBrands.set(next, brand);
        changed = true;
      }
      clones.set(value, next);
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
      for (const [key, item] of value.entries()) next.set(key, walk(item));
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

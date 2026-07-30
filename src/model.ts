import {
  wire,
  type AnyWireCodec,
  type CodecShape,
  type InputOf,
  type ShapeInput,
  type WireCodec,
  type WireValue,
} from "./wire.js";
import type { RpcConstraintError } from "./type-diagnostics.js";

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

/** Runtime-erased model metadata; use ModelDefinition to retain shape and key inference. */
export interface AnyModel {
  readonly $model: true;
  readonly name: string;
  readonly key: string | readonly string[];
  readonly keyFields: readonly string[];
}

export interface ModelDefinition<
  TName extends string = string,
  TShape extends CodecShape = CodecShape,
  TKey extends ShapeKeySpec<TShape> = ShapeKeySpec<TShape>,
> extends AnyModel {
  readonly $model: true;
  readonly name: TName;
  /** The identity field(s) as declared; present in the canonical shape and every pick. */
  readonly key: TKey;
  /** The identity fields, normalized. Composite keys encode values in this order. */
  readonly keyFields: readonly KeyField<TKey>[];
  /**
   * Prove that this model is an exact projection of an upstream row or
   * domain type. Extra source fields are allowed; every model field must
   * exist in the source with exactly the same TypeScript type.
   *
   * The source is type-only and this method returns the same model. It is a
   * drift check, not runtime reflection:
   *
   *     import type { users } from "./schema.js"
   *
   *     const User = defineModel("user", { ... })
   *       .$satisfies<typeof users.$inferSelect>()
   */
  /**
   * On a mismatch the compiler asks for an argument whose type spells out every
   * offending field and both sides — hover it, or pass anything to make the
   * message print.
   */
  $satisfies<TSource extends object>(
    ...mismatch: [MismatchedSourceFields<ShapeInput<TShape>, TSource>] extends [never]
      ? []
      : [mismatch: ModelSourceMismatch<ShapeInput<TShape>, TSource>]
  ): ModelDefinition<TName, TShape, TKey>;
  /**
   * A strict projection codec — a subset of the shape, still
   * identity-collecting. It validates an exact view; it does not strip fields
   * from a wider runtime object.
   * The key field is mandatory: an entity without its identity is just data.
   */
  pick<const TKeys extends readonly (keyof TShape & string)[]>(
    ...keys: Exclude<KeyField<TKey>, TKeys[number]> extends never
      ? TKeys
      : TKeys &
          RpcConstraintError<
            "model-selection-missing-identity-fields",
            Exclude<KeyField<TKey>, TKeys[number]>
          >
  ): WireCodec<ShapeInput<Pick<TShape, TKeys[number]>>, WireValue>;
  /**
   * A structured projection: `true` for the model's own fields, a codec for
   * anything nested or computed. Relationships and one-off aggregates read
   * alike, and every level keeps entity identity — so a nested model still
   * patches by id.
   *
   *     Hotel.select({
   *       id: true,
   *       name: true,
   *       topReviewer: UserCard,                 // another model's view
   *       recentReviews: wire.array(ReviewRow),  // to-many
   *       reviewCount: wire.number,              // computed, not a column
   *     })
   */
  select<
    const TSelection extends {
      readonly [TKey in keyof TSelection]: SelectionValue<TShape, TKey>;
    },
  >(
    selection: Exclude<KeyField<TKey>, SelectedOwnFields<TSelection>> extends never
      ? TSelection
      : TSelection &
          RpcConstraintError<
            "model-selection-missing-identity-fields",
            Exclude<KeyField<TKey>, SelectedOwnFields<TSelection>>
          >,
  ): WireCodec<SelectionInput<TShape, TSelection>, WireValue>;
  /**
   * Every field of the model, which means this output widens whenever the
   * model does. That is occasionally what you want (the viewer is the subject
   * of the record) and usually not — so it costs a sentence saying why, which
   * lands in review next to the decision.
   *
   *     User.all("viewer is the subject of this record")
   */
  all(reason: string): WireCodec<ShapeInput<TShape>, WireValue>;
}

/** `true` selects one of the model's own fields; a codec supplies any other. */
export type SelectionValue<TShape extends CodecShape, TKey> = TKey extends keyof TShape
  ? true | AnyWireCodec
  : AnyWireCodec;

export type SelectionInput<TShape extends CodecShape, TSelection> = {
  readonly [TKey in keyof TSelection]: TSelection[TKey] extends true
    ? TKey extends keyof TShape
      ? InputOf<TShape[TKey]>
      : never
    : TSelection[TKey] extends AnyWireCodec
      ? InputOf<TSelection[TKey]>
      : never;
};

export type ShapeKeySpec<TShape extends CodecShape> =
  | (keyof TShape & string)
  | readonly (keyof TShape & string)[];

export type KeyField<TKey> = TKey extends readonly (infer TField extends string)[] ? TField : TKey;

export type SelectedOwnFields<TSelection> = {
  [TKey in keyof TSelection]: TSelection[TKey] extends true ? TKey : never;
}[keyof TSelection];

export type ModelTypeEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
      ? true
      : false
    : false;

/**
 * Drops `readonly` so a source can be compared for the difference that matters.
 *
 * Wire codecs decode readonly by design, and a schema column does not, so a
 * correctly-aligned pair like `readonly string[]` and `string[]` failed the
 * identity test — a false positive on exactly the schemas the check exists to
 * bless. Mutability is not a difference in values, so it is normalized away.
 *
 * Nullability, scalar type and missing fields are untouched: those survive
 * normalization and still fail, which is the whole point of the check.
 * Functions are returned as-is — mapping over one erases its call signature —
 * and both sides get identical treatment, so the comparison stays symmetric.
 */
export type MutableModelType<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? MutableModelType<TItem>[]
    : T extends object
      ? { -readonly [TKey in keyof T]: MutableModelType<T[TKey]> }
      : T;

/** Identical, or identical once `readonly` is set aside. */
export type ModelTypeCompatible<TLeft, TRight> =
  ModelTypeEqual<TLeft, TRight> extends true
    ? true
    : ModelTypeEqual<MutableModelType<TLeft>, MutableModelType<TRight>>;

export type MismatchedSourceFields<TModel extends object, TSource> = {
  [TKey in keyof TModel]: TKey extends keyof TSource
    ? ModelTypeCompatible<TModel[TKey], TSource[TKey]> extends true
      ? never
      : TKey
    : TKey;
}[keyof TModel];

/**
 * Renders a field's type as text.
 *
 * A template literal can only interpolate literal types, so there is no way to
 * ask TypeScript to stringify an arbitrary one — the alternative is a diagnostic
 * that names a type alias the reader then has to go and read. Covering the wire
 * scalars plus arrays gets the cases a schema mismatch actually produces.
 *
 * Deliberately non-distributive (`[T] extends [X]`): a naive version turns
 * `string | null` into two messages that each claim the type is something it
 * partly is not, and `string | null` is precisely what a nullable column looks
 * like.
 */
export type PrintModelType<T> = [T] extends [never]
  ? "never"
  : unknown extends T
    ? "an unspecified type"
    : [T] extends [null]
      ? "null"
      : [null] extends [T]
        ? `${PrintModelType<Exclude<T, null>>} | null`
        : [undefined] extends [T]
          ? `${PrintModelType<Exclude<T, undefined>>} | undefined`
          : [T] extends [string]
            ? "string"
            : [T] extends [number]
              ? "number"
              : [T] extends [boolean]
                ? "boolean"
                : [T] extends [bigint]
                  ? "bigint"
                  : [T] extends [Date]
                    ? "Date"
                    : [T] extends [readonly (infer TItem)[]]
                      ? `${PrintModelType<TItem>}[]`
                      : "a different type";

/** One line per failing field, naming it and both sides. */
export type SourceFieldMessage<
  TModel extends object,
  TSource,
  TKey extends string,
> = TKey extends keyof TSource
  ? `field '${TKey}': the model declares ${PrintModelType<TModel[TKey & keyof TModel]>}, the source has ${PrintModelType<TSource[TKey]>}`
  : `field '${TKey}' is missing from the source`;

/**
 * Surfaced as a constraint violation rather than an arity error. TS2554
 * ("Expected 1 arguments, but got 0") never prints a type, which left readers
 * passing a deliberately wrong argument just to make the compiler reveal what
 * was expected; TS2344 prints both sides.
 *
 * One key, so the useful half is not truncated away by the message limit.
 */
/**
 * The constraint a source must satisfy.
 *
 * Resolves to string literals rather than a named generic, because TypeScript
 * prints an alias by *name* when one exists — so a carefully built structural
 * diagnostic shows up as `SourceFieldMismatch<Model, Row>` and tells the reader
 * nothing. Literals print verbatim, which is the whole point.
 *
 * `object` appears only in the passing branch: intersecting it with a string
 * literal collapses the constraint to `never`, and the reader is told the
 * constraint is `never` instead of what is wrong.
 */
export type ModelSourceMismatch<TModel extends object, TSource> = SourceFieldMessage<
  TModel,
  TSource,
  MismatchedSourceFields<TModel, TSource> & string
>;

export type ModelValue<TModel extends AnyModel> =
  TModel extends ModelDefinition<string, infer TShape> ? ShapeInput<TShape> : never;

export type ModelIdentityField<TModel extends AnyModel> =
  TModel["key"] extends readonly (infer TField extends string)[] ? TField : TModel["key"];

/**
 * The most a cache updater may know about one occurrence of an entity.
 * Identity is always present; every other canonical field is projection-dependent.
 */
export type ModelProjection<TModel extends AnyModel> = Readonly<
  Pick<ModelValue<TModel>, Extract<ModelIdentityField<TModel>, keyof ModelValue<TModel>>> &
    Partial<Omit<ModelValue<TModel>, Extract<ModelIdentityField<TModel>, keyof ModelValue<TModel>>>>
>;

export type ScalarKeyField<TShape extends CodecShape> = {
  [TKey in keyof TShape & string]: [InputOf<TShape[TKey]>] extends [never]
    ? never
    : [InputOf<TShape[TKey]>] extends [string | number]
      ? TKey
      : never;
}[keyof TShape & string];

export type ModelKeySpec<TShape extends CodecShape> =
  | ScalarKeyField<TShape>
  | readonly ScalarKeyField<TShape>[];

export interface DefineModelOptions<
  TShape extends CodecShape,
  TKey extends ModelKeySpec<TShape> = ModelKeySpec<TShape>,
> {
  /**
   * The field(s) carrying the identity (string or number values). A composite
   * key — e.g. `["id", "locale"]` for content that varies per locale under
   * one id — makes each combination its OWN entity: patching the `en`
   * variant never touches the `ja` variant.
   */
  readonly key: TKey;
  readonly shape: TShape;
}

/** How callers address an entity: a scalar id or an exact record of its key fields. */
export type ModelKeyRecord<TModel extends AnyModel> = Readonly<{
  [TField in KeyField<TModel["key"]>]: TField extends keyof ModelValue<TModel>
    ? Extract<ModelValue<TModel>[TField], string | number>
    : never;
}>;

export type SpecificModelKeyInput<
  TModel extends AnyModel,
  TKey = TModel["key"],
> = TKey extends readonly string[]
  ? ModelKeyRecord<TModel>
  : TKey extends keyof ModelValue<TModel>
    ? Extract<ModelValue<TModel>[TKey], string | number> | ModelKeyRecord<TModel>
    : never;

export type ModelKeyInput<TModel extends AnyModel = AnyModel> = string extends TModel["name"]
  ? string | number | Readonly<Record<string, string | number>>
  : SpecificModelKeyInput<TModel>;

declare const entityIdBrand: unique symbol;

/**
 * The canonical identity of one model value. This is deliberately distinct
 * from the scalar or key-field record accepted by cache APIs: it is an
 * encoded internal identity, not another spelling of a model key.
 */
export type EntityId<TModel extends AnyModel = AnyModel> = string & {
  readonly [entityIdBrand]: TModel["name"];
};

declare const entityCacheKeyBrand: unique symbol;

/** A model-qualified key used only by internal entity indexes. */
export type EntityCacheKey = EntityId & { readonly [entityCacheKeyBrand]: true };

/** Decoded-entity brands: object identity → its model. Global and inert. */
const entityBrands = new WeakMap<object, AnyModel>();

/** @internal Runtime proof used by cache projection adapters. */
export const isEntityRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isWireCodec = (value: unknown): value is AnyWireCodec =>
  value !== null &&
  typeof value === "object" &&
  typeof Reflect.get(value, "kind") === "string" &&
  typeof Reflect.get(value, "encode") === "function" &&
  typeof Reflect.get(value, "decode") === "function";

/** Internal: read a decoded object's model, if any. */
export const entityBrandOf = (value: object): AnyModel | undefined => entityBrands.get(value);

/** Internal: brand a value produced outside decode (patched/merged objects). */
export const brandEntity = (value: object, model: AnyModel): void => {
  entityBrands.set(value, model);
};

type IdentityPart = string | number;
type EncodedIdentityPart = readonly [type: "s" | "n", value: string];

const ENTITY_ID_PREFIX = "result-rpc:entity:1:";

/**
 * ECMAScript's finite-number string form is a canonical round-trippable
 * representation. The four non-finite/signed-zero cases need explicit names
 * so every value distinguished by `Object.is` has stable identity semantics.
 */
const encodeIdentityNumber = (value: number): string => {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
};

const encodeIdentityPart = (value: IdentityPart): EncodedIdentityPart =>
  typeof value === "string" ? ["s", value] : ["n", encodeIdentityNumber(value)];

/**
 * One encoder owns the complete cache identity. JSON array encoding is
 * injective here because every segment is a tagged two-tuple: model name,
 * scalar type, arity, empty strings, Unicode, and delimiter characters all
 * retain explicit boundaries.
 */
const encodeEntityIdentity = <TModel extends AnyModel>(
  model: TModel,
  parts: readonly IdentityPart[],
): EntityId<TModel> => {
  const encoded = JSON.stringify([
    encodeIdentityPart(model.name),
    ...parts.map(encodeIdentityPart),
  ]);
  // This constructor is the sole boundary that introduces the opaque brand.
  return `${ENTITY_ID_PREFIX}${encoded}` as EntityId<TModel>;
};

const isCanonicalEncodedNumber = (value: string): boolean => {
  if (value === "NaN" || value === "+Infinity" || value === "-Infinity" || value === "-0") {
    return true;
  }
  const number = Number(value);
  return Number.isFinite(number) && String(number) === value;
};

const isEncodedIdentityPart = (value: unknown): value is EncodedIdentityPart => {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[1] !== "string") return false;
  return value[0] === "s" || (value[0] === "n" && isCanonicalEncodedNumber(value[1]));
};

const encodedIdentityModelName = (value: string): string | undefined => {
  if (!value.startsWith(ENTITY_ID_PREFIX)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.slice(ENTITY_ID_PREFIX.length));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length < 2 || !parsed.every(isEncodedIdentityPart)) {
    return undefined;
  }
  const model = parsed[0];
  return model?.[0] === "s" ? model[1] : undefined;
};

/** @internal Reads a canonical, model-qualified id from a decoded entity. */
export const entityIdOf = <TModel extends AnyModel>(
  value: object,
  model: TModel,
): EntityId<TModel> | undefined => {
  const parts: IdentityPart[] = [];
  for (const field of model.keyFields) {
    const raw = Reflect.get(value, field);
    if (typeof raw !== "string" && typeof raw !== "number") return undefined;
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
export const entityIdFor = <TModel extends AnyModel>(
  model: TModel,
  id: ModelKeyInput<TModel>,
): EntityId<TModel> | undefined => {
  if (typeof id === "string" || typeof id === "number") {
    return model.keyFields.length === 1 ? encodeEntityIdentity(model, [id]) : undefined;
  }
  return entityIdOf(id, model);
};

/**
 * Converts an entity id to the internal cache-index key while checking the
 * model qualification. All cache keys therefore originate in the same full
 * tuple encoder; no caller may recreate one with string concatenation.
 */
export const entityKey = (model: string, id: EntityId): EntityCacheKey => {
  if (encodedIdentityModelName(id) !== model) {
    throw new TypeError(
      `Entity id is not the canonical identity for model ${JSON.stringify(model)}`,
    );
  }
  // Runtime validation above is the proof that this string is a cache key.
  return id as EntityCacheKey;
};

/** @internal Validates a model-qualified cache key received over the wire. */
export const entityCacheKeyFromWire = (value: string): EntityCacheKey | undefined =>
  encodedIdentityModelName(value) === undefined ? undefined : (value as EntityCacheKey);

const brandingCodec = <TValue>(
  inner: WireCodec<TValue, WireValue>,
  kind: string,
  model: () => AnyModel,
): WireCodec<TValue, WireValue> => ({
  kind,
  schema: JSON.stringify(["model", kind, inner.schema]),
  encode: (input) => inner.encode(input),
  decode: (value) => {
    const result = inner.decode(value);
    if (result.ok && result.value !== null && typeof result.value === "object") {
      entityBrands.set(result.value, model());
    }
    return result;
  },
});

function normalizeModelKey<TKey extends string | readonly string[]>(
  key: TKey,
): readonly KeyField<TKey>[];
function normalizeModelKey(key: string | readonly string[]): readonly string[] {
  return typeof key === "string" ? [key] : key;
}

export const defineModel = <
  const TName extends string,
  const TShape extends CodecShape,
  const TKey extends ModelKeySpec<TShape>,
>(
  name: TName,
  options: DefineModelOptions<TShape, TKey>,
): ModelDefinition<TName, TShape, TKey> => {
  // `TKey` is either the scalar field or its readonly tuple form; normalization
  // preserves exactly their element union.
  const keyFields = normalizeModelKey(options.key);
  if (keyFields.length === 0) {
    throw new TypeError(`Model ${name} declares an empty key`);
  }
  for (const field of keyFields) {
    if (!(field in options.shape)) {
      throw new TypeError(`Model ${name} declares key "${field}" but the shape has no such field`);
    }
  }
  let self: ModelDefinition<TName, TShape, TKey>;
  const requireKeyFields = (selected: readonly string[], what: string) => {
    for (const field of keyFields) {
      if (!selected.includes(field)) {
        throw new TypeError(
          `Model ${name} ${what} must include its key "${field}" — an entity without its identity is just data`,
        );
      }
    }
  };
  const select = <
    const TSelection extends {
      readonly [TSelectionKey in keyof TSelection]: SelectionValue<TShape, TSelectionKey>;
    },
  >(
    selection: Exclude<KeyField<TKey>, SelectedOwnFields<TSelection>> extends never
      ? TSelection
      : never,
  ): WireCodec<SelectionInput<TShape, TSelection>, WireValue> => {
    const keys = Object.keys(selection);
    const own = keys.filter((key) => Reflect.get(selection, key) === true);
    requireKeyFields(own, "selection");
    const subset: Record<string, AnyWireCodec> = {};
    for (const key of keys) {
      const value: unknown = Reflect.get(selection, key);
      if (value === true) {
        const codec = options.shape[key];
        if (!codec) {
          throw new TypeError(
            `Model ${name} has no field "${key}" — select true only for the model's own fields, or give a codec`,
          );
        }
        subset[key] = codec;
      } else {
        if (!isWireCodec(value)) {
          throw new TypeError(`Model ${name} selection "${key}" must be true or a wire codec`);
        }
        subset[key] = value;
      }
    }
    // The loop compiled exactly TSelection into the subset; Object.keys
    // necessarily erased the mapped input relationship.
    return brandingCodec(
      wire.object(subset),
      `model(${name}):{${[...keys].sort().join(",")}}`,
      () => self,
    ) as WireCodec<SelectionInput<TShape, TSelection>, WireValue>;
  };
  const pick = <const TKeys extends readonly (keyof TShape & string)[]>(
    ...keys: Exclude<KeyField<TKey>, TKeys[number]> extends never ? TKeys : never
  ): WireCodec<ShapeInput<Pick<TShape, TKeys[number]>>, WireValue> => {
    requireKeyFields(keys, "projection");
    const subset: Record<string, AnyWireCodec> = {};
    for (const key of keys) subset[key] = options.shape[key]!;
    // Each subset entry was selected from the same TShape at a TKeys member;
    // dynamic record construction erased the mapped input relationship.
    return brandingCodec(
      wire.object(subset),
      `model(${name}):${[...keys].sort().join(",")}`,
      () => self,
    ) as WireCodec<ShapeInput<Pick<TShape, TKeys[number]>>, WireValue>;
  };
  const definition: ModelDefinition<TName, TShape, TKey> = {
    $model: true,
    name,
    key: options.key,
    keyFields,
    $satisfies: () => self,
    all: (reason) => {
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new TypeError(
          `Model ${name}: all() ships every field, so it takes a reason — say why this output is allowed to widen with the model`,
        );
      }
      return brandingCodec<ShapeInput<TShape>>(
        wire.object(options.shape),
        `model(${name}):all`,
        () => self,
      );
    },
    select,
    pick,
  };
  self = definition;
  return Object.freeze(definition);
};

// --- Collection --------------------------------------------------------------

export interface CollectedEntity {
  readonly model: AnyModel;
  readonly id: EntityId;
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
      if (id !== undefined && isEntityRecord(value)) {
        found.push({ model, id, value });
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
export const patchEntity = <TModel extends AnyModel>(
  root: unknown,
  model: TModel,
  id: EntityId<TModel>,
  produce: (current: Record<string, unknown>) => Record<string, unknown>,
): { readonly value: unknown; readonly changed: boolean } => {
  let changed = false;
  const clones = new WeakMap<object, unknown>();
  const walk = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    const cached = clones.get(value);
    if (cached !== undefined) return cached;
    const brand = entityBrands.get(value);
    if (brand === model && entityIdOf(value, brand) === id && isEntityRecord(value)) {
      // Walk INTO the produced replacement: a nested occurrence of the same
      // entity (including a self-reference cycle) must be patched too, and
      // cycles must rebind to the clone, not dangle on the original.
      const produced = produce(value);
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
            const resultId = entityIdOf(result, aBrand);
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
      const copy: unknown[] = Array.from({ length: b.length });
      let equal = 0;
      for (let index = 0; index < b.length; index += 1) {
        copy[index] = share(a[index], b[index]);
        if (index < a.length && Object.is(copy[index], a[index])) equal += 1;
      }
      visiting.delete(b);
      return finish(a.length === b.length && equal === b.length ? a : copy);
    }
    if (
      !aIsArray &&
      !bIsArray &&
      a !== null &&
      typeof a === "object" &&
      Object.getPrototypeOf(a) === Object.prototype &&
      Object.getPrototypeOf(b) === Object.prototype
    ) {
      if (visiting.has(b)) return b;
      visiting.add(b);
      const bKeys = Object.keys(b);
      const copy: Record<string, unknown> = {};
      let equal = 0;
      for (const key of bKeys) {
        const previousValue = Reflect.get(a, key);
        copy[key] = share(previousValue, Reflect.get(b, key));
        if (key in a && Object.is(copy[key], previousValue)) equal += 1;
      }
      visiting.delete(b);
      return finish(Object.keys(a).length === bKeys.length && equal === bKeys.length ? a : copy);
    }
    // Rich values (Date, Map, Set, URL, ...), type mismatches, and fresh
    // subtrees take the new side wholesale — its interior is already branded
    // by the decode or patch that produced it.
    return finish(b);
  };
  return share(previous, next);
};

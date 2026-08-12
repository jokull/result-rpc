import { type AnyWireCodec, type CodecShape, type InputOf, type ShapeInput, type WireCodec, type WireValue } from "./wire.js";
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
export interface ModelDefinition<TName extends string = string, TShape extends CodecShape = CodecShape, TKey extends ShapeKeySpec<TShape> = ShapeKeySpec<TShape>> extends AnyModel {
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
     *
     * The erased `this` parameter is the proof site. It does not add a runtime
     * argument, but on a mismatch it makes the receiver incompatible with a
     * string literal that spells out every offending field and both sides. That
     * puts the useful diagnostic on the bare call instead of behind a hover or a
     * deliberately wrong argument.
     */
    $satisfies<TSource extends object>(this: [MismatchedSourceFields<ShapeInput<TShape>, TSource>] extends [never] ? unknown : ModelSourceMismatch<ShapeInput<TShape>, TSource>): ModelDefinition<TName, TShape, TKey>;
    /**
     * A strict projection codec — a subset of the shape, still
     * identity-collecting. It validates an exact view; it does not strip fields
     * from a wider runtime object.
     * The key field is mandatory: an entity without its identity is just data.
     */
    pick<const TKeys extends readonly (keyof TShape & string)[]>(...keys: Exclude<KeyField<TKey>, TKeys[number]> extends never ? TKeys : TKeys & RpcConstraintError<"model-selection-missing-identity-fields", Exclude<KeyField<TKey>, TKeys[number]>>): WireCodec<ShapeInput<Pick<TShape, TKeys[number]>>, WireValue>;
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
    select<const TSelection extends {
        readonly [TKey in keyof TSelection]: SelectionValue<TShape, TKey>;
    }>(selection: Exclude<KeyField<TKey>, SelectedOwnFields<TSelection>> extends never ? TSelection : TSelection & RpcConstraintError<"model-selection-missing-identity-fields", Exclude<KeyField<TKey>, SelectedOwnFields<TSelection>>>): WireCodec<SelectionInput<TShape, TSelection>, WireValue>;
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
export type SelectionValue<TShape extends CodecShape, TKey> = TKey extends keyof TShape ? true | AnyWireCodec : AnyWireCodec;
export type SelectionInput<TShape extends CodecShape, TSelection> = {
    readonly [TKey in keyof TSelection]: TSelection[TKey] extends true ? TKey extends keyof TShape ? InputOf<TShape[TKey]> : never : TSelection[TKey] extends AnyWireCodec ? InputOf<TSelection[TKey]> : never;
};
export type ShapeKeySpec<TShape extends CodecShape> = (keyof TShape & string) | readonly (keyof TShape & string)[];
export type KeyField<TKey> = TKey extends readonly (infer TField extends string)[] ? TField : TKey;
export type SelectedOwnFields<TSelection> = {
    [TKey in keyof TSelection]: TSelection[TKey] extends true ? TKey : never;
}[keyof TSelection];
export type ModelTypeEqual<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => (T extends TRight ? 1 : 2) ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => (T extends TLeft ? 1 : 2) ? true : false : false;
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
export type MutableModelType<T> = T extends (...args: never[]) => unknown ? T : T extends readonly (infer TItem)[] ? MutableModelType<TItem>[] : T extends object ? {
    -readonly [TKey in keyof T]: MutableModelType<T[TKey]>;
} : T;
/** Identical, or identical once `readonly` is set aside. */
export type ModelTypeCompatible<TLeft, TRight> = ModelTypeEqual<TLeft, TRight> extends true ? true : ModelTypeEqual<MutableModelType<TLeft>, MutableModelType<TRight>>;
export type MismatchedSourceFields<TModel extends object, TSource> = {
    [TKey in keyof TModel]: TKey extends keyof TSource ? ModelTypeCompatible<TModel[TKey], TSource[TKey]> extends true ? never : TKey : TKey;
}[keyof TModel];
/**
 * Whether the consumer compiles with `strictNullChecks`.
 *
 * Without it `null` is assignable to every type, which the printer below must
 * know: its nullable branch would otherwise match everything and never
 * terminate.
 */
export type HasStrictNullChecks = [null] extends [string] ? false : true;
/**
 * The scalar tail of {@link PrintModelType}, shared by both branches so the
 * nullable prefix is the only thing `strictNullChecks` decides.
 */
export type PrintModelScalar<T> = [T] extends [string] ? "string" : [T] extends [number] ? "number" : [T] extends [boolean] ? "boolean" : [T] extends [bigint] ? "bigint" : [T] extends [Date] ? "Date" : [T] extends [readonly (infer TItem)[]] ? `${PrintModelType<TItem>}[]` : "a different type";
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
 *
 * The nullable branches are skipped entirely without `strictNullChecks`. There,
 * `[null] extends [T]` holds for every `T` while `Exclude<T, null>` removes
 * nothing, so the recursion has no base case: it emitted `${any} | null | null
 * | …` until the compiler gave up with TS2589. A reader whose config cannot
 * distinguish `string` from `string | null` is told so by
 * {@link ModelSourceMismatch} rather than shown a type that is wrong.
 */
export type PrintModelType<T> = [T] extends [never] ? "never" : unknown extends T ? "an unspecified type" : HasStrictNullChecks extends false ? PrintModelScalar<T> : [T] extends [null] ? "null" : [null] extends [T] ? `${PrintModelType<Exclude<T, null>>} | null` : [undefined] extends [T] ? `${PrintModelType<Exclude<T, undefined>>} | undefined` : PrintModelScalar<T>;
/**
 * Without `strictNullChecks` a nullable column and a non-nullable one are the
 * same type, so the assertion's main job is silently not being done. The note
 * is interpolated into the message rather than unioned alongside it: a union
 * containing a deferred conditional makes TypeScript print
 * `ModelSourceMismatch<…>` by name, which is the alias-printing failure this
 * whole design exists to avoid. Inside a template literal it resolves eagerly
 * and the reader still gets text.
 */
export type NullabilityCaveat = HasStrictNullChecks extends true ? "" : " (strictNullChecks is off, so nullability was not compared)";
/** One line per failing field, naming it and both sides. */
export type SourceFieldMessage<TModel extends object, TSource, TKey extends string> = TKey extends keyof TSource ? `field '${TKey}': the model declares ${PrintModelType<TModel[TKey & keyof TModel]>}, the source has ${PrintModelType<TSource[TKey]>}${NullabilityCaveat}` : `field '${TKey}' is missing from the source`;
/**
 * The diagnostic a source must satisfy.
 *
 * Resolves to string literals rather than a named generic, because TypeScript
 * prints an alias by *name* when one exists — so a carefully built structural
 * diagnostic shows up as `SourceFieldMismatch<Model, Row>` and tells the reader
 * nothing. Literals print verbatim, which is the whole point.
 *
 * The literal becomes the method's erased `this` type on failure. TypeScript
 * includes it in TS2684 at the bare call site, avoiding both a circular generic
 * constraint (TS2313) and an unhelpful missing-argument error (TS2554).
 */
export type ModelSourceMismatch<TModel extends object, TSource> = SourceFieldMessage<TModel, TSource, MismatchedSourceFields<TModel, TSource> & string>;
export type ModelValue<TModel extends AnyModel> = TModel extends ModelDefinition<string, infer TShape> ? ShapeInput<TShape> : never;
export type ModelIdentityField<TModel extends AnyModel> = TModel["key"] extends readonly (infer TField extends string)[] ? TField : TModel["key"];
/**
 * The most a cache updater may know about one occurrence of an entity.
 * Identity is always present; every other canonical field is projection-dependent.
 */
export type ModelProjection<TModel extends AnyModel> = Readonly<Pick<ModelValue<TModel>, Extract<ModelIdentityField<TModel>, keyof ModelValue<TModel>>> & Partial<Omit<ModelValue<TModel>, Extract<ModelIdentityField<TModel>, keyof ModelValue<TModel>>>>>;
export type ScalarKeyField<TShape extends CodecShape> = {
    [TKey in keyof TShape & string]: [InputOf<TShape[TKey]>] extends [never] ? never : [InputOf<TShape[TKey]>] extends [string | number] ? TKey : never;
}[keyof TShape & string];
export type ModelKeySpec<TShape extends CodecShape> = ScalarKeyField<TShape> | readonly ScalarKeyField<TShape>[];
export interface DefineModelOptions<TShape extends CodecShape, TKey extends ModelKeySpec<TShape> = ModelKeySpec<TShape>> {
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
    [TField in KeyField<TModel["key"]>]: TField extends keyof ModelValue<TModel> ? Extract<ModelValue<TModel>[TField], string | number> : never;
}>;
export type SpecificModelKeyInput<TModel extends AnyModel, TKey = TModel["key"]> = TKey extends readonly string[] ? ModelKeyRecord<TModel> : TKey extends keyof ModelValue<TModel> ? Extract<ModelValue<TModel>[TKey], string | number> | ModelKeyRecord<TModel> : never;
export type ModelKeyInput<TModel extends AnyModel = AnyModel> = string extends TModel["name"] ? string | number | Readonly<Record<string, string | number>> : SpecificModelKeyInput<TModel>;
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
export type EntityCacheKey = EntityId & {
    readonly [entityCacheKeyBrand]: true;
};
/** @internal Runtime proof used by cache projection adapters. */
export declare const isEntityRecord: (value: unknown) => value is Record<string, unknown>;
/** Internal: read a decoded object's model, if any. */
export declare const entityBrandOf: (value: object) => AnyModel | undefined;
/** Internal: brand a value produced outside decode (patched/merged objects). */
export declare const brandEntity: (value: object, model: AnyModel) => void;
/** @internal Reads a canonical, model-qualified id from a decoded entity. */
export declare const entityIdOf: <TModel extends AnyModel>(value: object, model: TModel) => EntityId<TModel> | undefined;
/**
 * Resolves a caller-supplied key to the entity's opaque canonical id. Records
 * must carry every key field. A bare scalar addresses only a single-field
 * key; composite keys require their structured record, so segment boundaries
 * cannot be guessed from a pre-joined string.
 */
export declare const entityIdFor: <TModel extends AnyModel>(model: TModel, id: ModelKeyInput<TModel>) => EntityId<TModel> | undefined;
/**
 * Converts an entity id to the internal cache-index key while checking the
 * model qualification. All cache keys therefore originate in the same full
 * tuple encoder; no caller may recreate one with string concatenation.
 */
export declare const entityKey: (model: string, id: EntityId) => EntityCacheKey;
/** @internal Validates a model-qualified cache key received over the wire. */
export declare const entityCacheKeyFromWire: (value: string) => EntityCacheKey | undefined;
export declare const defineModel: <const TName extends string, const TShape extends CodecShape, const TKey extends ModelKeySpec<TShape>>(name: TName, options: DefineModelOptions<TShape, TKey>) => ModelDefinition<TName, TShape, TKey>;
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
export declare const collectEntities: (root: unknown) => readonly CollectedEntity[];
/**
 * The projection rule: merge only the keys the cached object already has.
 * One model, one field vocabulary; projections are subsets — so overlapping
 * keys are type-compatible by contract, and fields the source doesn't carry
 * stay as they were. Returns the original object when nothing changes.
 */
export declare const mergeByExistingKeys: (current: Record<string, unknown>, fresh: Record<string, unknown>) => Record<string, unknown>;
/**
 * Replaces every occurrence of the identified entity inside a decoded value,
 * by identity match on branded objects. Clones the containers along the way
 * (cycle-safe, shared references preserved, brands carried onto clones);
 * returns the original root untouched when no occurrence changed.
 */
export declare const patchEntity: <TModel extends AnyModel>(root: unknown, model: TModel, id: EntityId<TModel>, produce: (current: Record<string, unknown>) => Record<string, unknown>) => {
    readonly value: unknown;
    readonly changed: boolean;
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
export declare const shareStructural: (previous: unknown, next: unknown) => unknown;
export {};

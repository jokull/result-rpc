import type { AnyPublicErrorDefinition, ErrorOf } from "./error.js";
import type { RpcConstraintError } from "./type-diagnostics.js";

/** Error definitions admitted to an RPC contract. Private errors are server-only. */
export type ErrorDefinitionMap = Readonly<Record<string, AnyPublicErrorDefinition>>;

/** The exact error union represented by a declaration or composed definition map. */
export type ErrorUnion<TDefinitions extends ErrorDefinitionMap> = ErrorOf<
  TDefinitions extends unknown ? TDefinitions[Extract<keyof TDefinitions, string>] : never
>;

/**
 * Definition maps compose by intersection because equal keys must identify
 * the same definition. Runtime validation rejects conflicting keys or tags.
 */
export type MergeDefinitionMaps<
  TLeft extends ErrorDefinitionMap,
  TRight extends ErrorDefinitionMap,
> = TLeft & TRight;

export type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

/**
 * Middleware graphs accumulate definition maps as a union of contributions.
 * Shared ancestry then deduplicates naturally instead of recursively copying
 * the same intersections down every diamond edge. Materialization happens only
 * where callers need the keyed `errors` object.
 */
export type MaterializeDefinitionSources<TSources extends ErrorDefinitionMap> = [TSources] extends [
  never,
]
  ? {}
  : UnionToIntersection<TSources> extends infer TDefinitions extends ErrorDefinitionMap
    ? TDefinitions
    : never;

export type MergeDefinitionSources<
  TLeft extends ErrorDefinitionMap,
  TRight extends ErrorDefinitionMap,
> = TLeft | TRight;

export type DefinitionTypeEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
      ? true
      : false
    : false;

export type ConflictingDefinitionKeys<
  TLeft extends ErrorDefinitionMap,
  TRight extends ErrorDefinitionMap,
> = {
  [TKey in Extract<keyof TLeft & keyof TRight, string>]: DefinitionTypeEqual<
    TLeft[TKey],
    TRight[TKey]
  > extends true
    ? never
    : TKey;
}[Extract<keyof TLeft & keyof TRight, string>];

export type DefinitionAtTag<
  TDefinitions extends ErrorDefinitionMap,
  TTag extends string,
> = TDefinitions[Extract<keyof TDefinitions, string>] extends infer TDefinition
  ? TDefinition extends { readonly tag: TTag }
    ? TDefinition
    : never
  : never;

export type ConflictingDefinitionTags<
  TLeft extends ErrorDefinitionMap,
  TRight extends ErrorDefinitionMap,
> = {
  [TKey in Extract<keyof TRight, string>]: TRight[TKey] extends {
    readonly tag: infer TTag extends string;
  }
    ? [DefinitionAtTag<TLeft, TTag>] extends [never]
      ? never
      : DefinitionTypeEqual<TRight[TKey], DefinitionAtTag<TLeft, TTag>> extends true
        ? never
        : TTag
    : never;
}[Extract<keyof TRight, string>];

export type ConflictingDefinitionSourceKeys<
  TLeft extends ErrorDefinitionMap,
  TRight extends ErrorDefinitionMap,
> = TLeft extends unknown
  ? TRight extends unknown
    ? ConflictingDefinitionKeys<TLeft, TRight>
    : never
  : never;

export type ConflictingDefinitionSourceTags<
  TLeft extends ErrorDefinitionMap,
  TRight extends ErrorDefinitionMap,
> = TLeft extends unknown
  ? TRight extends unknown
    ? ConflictingDefinitionTags<TLeft, TRight>
    : never
  : never;

/** Static half of definition identity; exact reference identity is checked at runtime. */
export type DefinitionMapCompatibility<
  TLeft extends ErrorDefinitionMap,
  TRight extends ErrorDefinitionMap,
> = [ConflictingDefinitionKeys<TLeft, TRight>] extends [never]
  ? [ConflictingDefinitionTags<TLeft, TRight>] extends [never]
    ? unknown
    : RpcConstraintError<
        "conflicting-error-definition-tags",
        ConflictingDefinitionTags<TLeft, TRight>
      >
  : RpcConstraintError<
      "conflicting-error-definition-keys",
      ConflictingDefinitionKeys<TLeft, TRight>
    >;

/** Pairwise compatibility for the (normally small) incoming contribution set. */
export type DefinitionSourcesCompatibility<
  TLeft extends ErrorDefinitionMap,
  TRight extends ErrorDefinitionMap,
> = [ConflictingDefinitionSourceKeys<TLeft, TRight>] extends [never]
  ? [ConflictingDefinitionSourceTags<TLeft, TRight>] extends [never]
    ? unknown
    : RpcConstraintError<
        "conflicting-error-definition-tags",
        ConflictingDefinitionSourceTags<TLeft, TRight>
      >
  : RpcConstraintError<
      "conflicting-error-definition-keys",
      ConflictingDefinitionSourceKeys<TLeft, TRight>
    >;

export const assertDefinitionsCanMerge = (
  left: ErrorDefinitionMap,
  right: ErrorDefinitionMap,
): void => {
  const byTag = new Map(Object.values(left).map((definition) => [definition.tag, definition]));
  for (const [key, definition] of Object.entries(right)) {
    const existingAtKey = left[key];
    if (existingAtKey !== undefined && existingAtKey !== definition) {
      throw new TypeError(`Conflicting definitions for error key ${key}`);
    }
    const existingWithTag = byTag.get(definition.tag);
    if (existingWithTag !== undefined && existingWithTag !== definition) {
      throw new TypeError(`Conflicting definitions for error tag ${definition.tag}`);
    }
    byTag.set(definition.tag, definition);
  }
};

export const mergeDefinitionMaps = <
  TLeft extends ErrorDefinitionMap,
  TRight extends ErrorDefinitionMap,
>(
  left: TLeft,
  right: TRight,
): MergeDefinitionMaps<TLeft, TRight> => {
  assertDefinitionsCanMerge(left, right);
  // Object spread implements the record intersection after the runtime check
  // rejects every overlapping key/tag that does not share one definition.
  return { ...left, ...right } as MergeDefinitionMaps<TLeft, TRight>;
};

/**
 * Injects an error from a smaller definition environment into a larger one.
 * The `extends` relation is the proof; the assertion only bridges TS's
 * inability to reduce indexed access over generic record intersections.
 */
export const widenDefinitionError = <TNarrow extends ErrorDefinitionMap, TWide extends TNarrow>(
  error: ErrorUnion<TNarrow>,
): ErrorUnion<TWide> => error as ErrorUnion<TWide>;

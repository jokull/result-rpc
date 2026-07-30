import type { ErrorDefinitionMap, ErrorUnion } from "./error-map.js";
import type { AnyModel, ModelKeyInput } from "./model.js";
import type { ProcedureCapability, UnaryProcedureCapability } from "./procedure-capability.js";
import type { RpcConstraintError } from "./type-diagnostics.js";
import type { AnyWireCodec, WireCodec, WireValue } from "./wire.js";

export interface Page<TItem, TCursor> {
  readonly items: readonly TItem[];
  readonly nextCursor: TCursor | null;
}

export interface PageRequest<TListInput, TCursor> {
  readonly list: TListInput;
  readonly cursor: TCursor | null;
}

export interface PaginationManifest {
  readonly cursor: AnyWireCodec;
  readonly item: AnyWireCodec;
}

/** Runtime query target shared by contract and executable declarations. */
export type QueryAffectsTarget = {
  readonly _kind: "procedure-contract" | "procedure";
  readonly _def: {
    readonly kind: "query";
    readonly input: AnyWireCodec;
    readonly output: AnyWireCodec;
    readonly definitions: ErrorDefinitionMap;
    readonly capability: ProcedureCapability;
  };
};

export interface AffectsEntry {
  readonly target: QueryAffectsTarget;
  readonly map?: (input: unknown) => unknown;
}

export type ProcedureAffectsInput<TTarget extends QueryAffectsTarget> = TTarget extends {
  readonly _def: {
    readonly input: WireCodec<infer TInput, WireValue>;
    readonly capability: infer TCapability;
  };
}
  ? TCapability extends {
      readonly mode: "paginated";
      readonly _types: { readonly listInput: infer TListInput };
    }
    ? TListInput
    : TInput
  : never;

export interface WritesEntry {
  readonly model: AnyModel;
  readonly map: (input: unknown) => ModelKeyInput;
}

export type ProcedureKind = "query" | "mutation" | "subscription";

/** Every compile-time fact carried by one procedure through its lifecycle. */
export interface ProcedureTypes<
  TRootContext,
  TContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
  TKind extends ProcedureKind = ProcedureKind,
  TCapability extends ProcedureCapability = UnaryProcedureCapability,
  TMappedInput = never,
> {
  readonly rootContext: TRootContext;
  readonly context: TContext;
  readonly input: TInput;
  readonly output: TOutput;
  readonly definitions: TDefinitions;
  readonly kind: TKind;
  readonly capability: TCapability;
  readonly writesHeaders: TCapability["writesHeaders"];
  /** Input captured by `.affects()`/`.writes()` mappers; `never` while replaceable. */
  readonly mappedInput: TMappedInput;
}

/** Runtime-erased procedure facts. Specific records are covariant subtypes. */
export interface AnyProcedureTypes {
  readonly rootContext: unknown;
  readonly context: unknown;
  readonly input: unknown;
  readonly output: unknown;
  readonly definitions: ErrorDefinitionMap;
  readonly kind: ProcedureKind;
  readonly capability: ProcedureCapability;
  readonly writesHeaders: boolean;
  readonly mappedInput: unknown;
}

export type WithProcedureInput<TTypes extends AnyProcedureTypes, TInput> = ProcedureTypes<
  TTypes["rootContext"],
  TTypes["context"],
  TInput,
  TTypes["output"],
  TTypes["definitions"],
  TTypes["kind"],
  TTypes["capability"],
  TTypes["mappedInput"]
>;

export type WithProcedureOutput<TTypes extends AnyProcedureTypes, TOutput> = ProcedureTypes<
  TTypes["rootContext"],
  TTypes["context"],
  TTypes["input"],
  TOutput,
  TTypes["definitions"],
  TTypes["kind"],
  TTypes["capability"],
  TTypes["mappedInput"]
>;

export type WithProcedureKinds<
  TTypes extends AnyProcedureTypes,
  TKind extends ProcedureKind,
> = ProcedureTypes<
  TTypes["rootContext"],
  TTypes["context"],
  TTypes["input"],
  TTypes["output"],
  TTypes["definitions"],
  TKind,
  TTypes["capability"],
  TTypes["mappedInput"]
>;

export type WithProcedureDefinitions<
  TTypes extends AnyProcedureTypes,
  TDefinitions extends ErrorDefinitionMap,
> = ProcedureTypes<
  TTypes["rootContext"],
  TTypes["context"],
  TTypes["input"],
  TTypes["output"],
  TDefinitions,
  TTypes["kind"],
  TTypes["capability"],
  TTypes["mappedInput"]
>;

export type WithProcedureContext<
  TTypes extends AnyProcedureTypes,
  TContext,
  TDefinitions extends ErrorDefinitionMap,
  TCapability extends ProcedureCapability,
> = ProcedureTypes<
  TTypes["rootContext"],
  TContext,
  TTypes["input"],
  TTypes["output"],
  TDefinitions,
  TTypes["kind"],
  TCapability,
  TTypes["mappedInput"]
>;

export type WithProcedureMappedInput<TTypes extends AnyProcedureTypes> = ProcedureTypes<
  TTypes["rootContext"],
  TTypes["context"],
  TTypes["input"],
  TTypes["output"],
  TTypes["definitions"],
  TTypes["kind"],
  TTypes["capability"],
  TTypes["input"]
>;

/**
 * Narrows the kind to `subscription`: a resume point is only meaningful for a
 * stream that can be interrupted and reopened. Deliberately adds nothing to the
 * context or capability — `lastEventId` is on every subscription's handler args
 * either way, so declaring resumability costs no type instantiations.
 */
export type WithProcedureResumable<TTypes extends AnyProcedureTypes> = WithProcedureKinds<
  TTypes,
  Extract<TTypes["kind"], "subscription">
>;

export type WithProcedureHeaders<TTypes extends AnyProcedureTypes> = WithProcedureContext<
  WithProcedureKinds<TTypes, Exclude<TTypes["kind"], "subscription">>,
  TTypes["context"] & { readonly headers: Headers },
  TTypes["definitions"],
  UnaryProcedureCapability<true>
>;

/** Terminal types deliberately discard builder-only mapper binding state. */
export type CompleteProcedureTypes<
  TTypes extends AnyProcedureTypes,
  TKind extends ProcedureKind,
  TCapability extends ProcedureCapability,
  TInput = TTypes["input"],
  TOutput = TTypes["output"],
> = ProcedureTypes<
  TTypes["rootContext"],
  TTypes["context"],
  TInput,
  TOutput,
  TTypes["definitions"],
  TKind,
  TCapability,
  never
>;

export type ProcedureTerminalConstraint<
  TTypes extends AnyProcedureTypes,
  TKind extends ProcedureKind,
> = [TTypes["output"]] extends [never]
  ? RpcConstraintError<"procedure-output-required", TKind>
  : TKind extends TTypes["kind"]
    ? unknown
    : RpcConstraintError<
        "procedure-kind-unavailable",
        { readonly requested: TKind; readonly allowed: TTypes["kind"] }
      >;

export type ProcedureInputConstraint<TTypes extends AnyProcedureTypes> = [
  TTypes["mappedInput"],
] extends [never]
  ? unknown
  : RpcConstraintError<"procedure-input-already-bound-to-cache-mapper", TTypes["mappedInput"]>;

export interface ProcedureContractManifest<TTypes extends AnyProcedureTypes> {
  readonly kind: TTypes["kind"];
  readonly input: WireCodec<TTypes["input"], WireValue>;
  readonly output: WireCodec<TTypes["output"], WireValue>;
  readonly definitions: TTypes["definitions"];
  readonly capability: TTypes["capability"];
  readonly affects?: readonly AffectsEntry[];
  readonly writes?: readonly WritesEntry[];
  readonly pagination?: PaginationManifest;
  readonly writesHeaders?: true;
  /** Declared by `.resumable()`: derives an event's resume token from its value. */
  readonly resumable?: { readonly eventId: (value: never) => string };
}

declare const procedureTypes: unique symbol;

/** Hidden carrier shared by contracts and executable procedures. */
export interface ProcedureTypeCarrier<TTypes extends AnyProcedureTypes> {
  readonly [procedureTypes]?: TTypes;
}

export interface ProcedureContract<
  TTypes extends AnyProcedureTypes,
> extends ProcedureTypeCarrier<TTypes> {
  readonly _kind: "procedure-contract";
  readonly _def: ProcedureContractManifest<TTypes>;
}

export type ProcedureTypesOf<TProcedure> =
  TProcedure extends ProcedureTypeCarrier<infer TTypes> ? TTypes : never;

export type ProcedureInput<TProcedure> = ProcedureTypesOf<TProcedure>["input"];
export type ProcedureOutput<TProcedure> = ProcedureTypesOf<TProcedure>["output"];
export type ProcedureError<TProcedure> = ErrorUnion<ProcedureTypesOf<TProcedure>["definitions"]>;

/** Runtime contract shape whose codecs cannot be invoked without a proof boundary. */
export interface AnyProcedureContract extends ProcedureTypeCarrier<AnyProcedureTypes> {
  readonly _kind: "procedure-contract";
  readonly _def: {
    readonly kind: ProcedureKind;
    readonly input: AnyWireCodec;
    readonly output: AnyWireCodec;
    readonly definitions: ErrorDefinitionMap;
    readonly capability: ProcedureCapability;
    readonly affects?: readonly AffectsEntry[];
    readonly writes?: readonly WritesEntry[];
    readonly pagination?: PaginationManifest;
    readonly writesHeaders?: true;
    /** Declared by `.resumable()`: derives an event's resume token from its value. */
    readonly resumable?: { readonly eventId: (value: never) => string };
  };
}

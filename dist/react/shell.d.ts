import { type ReactNode } from "react";
import { type AnyTaggedError } from "../error.js";
import type { AnyProcedureClientTypes, ClientUnaryTypes, ProcedureClientTypeCarrier } from "../client/base-client.js";
import type { EmptyObject } from "../wire.js";
import type { RpcConstraintError } from "../type-diagnostics.js";
import type { AnyLayer, LayerShape } from "../layer.js";
import { type ClaimRegistry } from "./claims.js";
import type { ErrorDefinitionMap, ErrorUnion } from "../server/contract.js";
import type { MutationOptions, MutationState, NarrowProcedureClient, PaginatedClientItem, PaginatedClientListInput, PaginatedProcedureClientLike, PaginatedState, ProcedureClientError, ProcedureClientInput, ProcedureClientOutput, ProcedureClientResult, QueryOptions, QueryRuntime, QueryState, SubscriptionClientError, SubscriptionClientOutput, SubscriptionState } from "../query/runtime.js";
import { useResultClient, type MutationProcedureClientLike, type QueryHookArgs, type QueryProcedureClientLike, type SubscriptionHookArgs, type SubscriptionProcedureClientLike } from "./index.js";
export type ErrorSignature<TError> = TError extends {
    readonly _tag: infer TTag;
    readonly data: infer TData;
    readonly visibility: infer TVisibility;
} ? readonly [tag: TTag, data: TData, visibility: TVisibility] : never;
export type ErrorData<TError> = TError extends {
    readonly data: infer TData;
} ? TData : never;
export type IsTypeEqual<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => (T extends TRight ? 1 : 2) ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => (T extends TLeft ? 1 : 2) ? true : false : false;
export type HasExactClaim<TError, TClaimedError> = TClaimedError extends AnyTaggedError ? IsTypeEqual<keyof ErrorData<TError>, keyof ErrorData<TClaimedError>> extends true ? IsTypeEqual<ErrorSignature<TError>, ErrorSignature<TClaimedError>> extends true ? true : never : never : never;
/**
 * Removes only procedure-error members whose complete public signature is
 * owned by a shell. The distributive outer conditional preserves every other
 * member verbatim; a shared tag alone is deliberately insufficient.
 */
export type SubtractClaimedErrors<TError, TClaimedError extends AnyTaggedError> = TError extends AnyTaggedError ? true extends HasExactClaim<TError, TClaimedError> ? never : TError : TError;
export type TagsOf<TDefinitions extends ErrorDefinitionMap> = TDefinitions[keyof TDefinitions]["tag"];
/**
 * `pause` keeps the operation in a non-terminal state and hands the error to the
 * shell. `escalate` throws the tagged value to the nearest React error boundary.
 */
export type ShellEffect = "pause" | "escalate";
export interface ShellHoldings<TError extends AnyTaggedError> {
    /** Most recently reported claimed error, if any operation is currently held. */
    readonly latest: TError | undefined;
    /** Every distinct claimed error currently held by this shell. */
    readonly errors: readonly TError[];
    /** How many distinct operations are currently held by this shell. */
    readonly affected: number;
    /**
     * Retries every operation this shell is holding — the end of the pause arc:
     * claim, hold, fix the condition (re-authenticate, reconnect), resume.
     * Queries refetch and subscriptions reconnect; held mutations reset to
     * idle — their failure was already delivered to the caller as the claimed
     * rejection, and replaying a side effect is never the shell's call to make.
     */
    readonly resume: () => void;
}
export interface ShellErrorRegistry<TError extends AnyTaggedError> extends ClaimRegistry<TError> {
}
export type ShellClaimedErrors<TDefinitions extends ErrorDefinitionMap, TParent extends AnyShell | undefined> = ErrorUnion<TDefinitions> | (TParent extends AnyShell ? ClaimedErrorsBy<TParent> : never);
/**
 * The non-generic runtime identity shared by every shell. This is the
 * existential constraint used while composing shell chains; importantly, it
 * does not instantiate the generic hook surface with `any`.
 */
export interface AnyShell {
    readonly $shell: true;
    readonly $errors: ShellErrorRegistry<AnyTaggedError>;
    readonly name: string;
    readonly effect: ShellEffect;
    readonly claims: ErrorDefinitionMap;
    readonly parent: AnyShell | undefined;
    readonly ownTags: readonly string[];
    readonly claimedTags: readonly string[];
    use(): unknown;
    useHeld(): ShellHoldings<AnyTaggedError>;
}
export interface Shell<TDefinitions extends ErrorDefinitionMap = ErrorDefinitionMap, TParent extends AnyShell | undefined = AnyShell | undefined, TProps = Record<never, never>, TValue = unknown> extends AnyShell {
    readonly $shell: true;
    readonly name: string;
    readonly effect: ShellEffect;
    /** Runtime guard and associated type for every error this shell chain claims. */
    readonly $errors: ShellErrorRegistry<ShellClaimedErrors<TDefinitions, TParent>>;
    /** The exact definitions owned by this shell. */
    readonly claims: TDefinitions;
    /** The exact enclosing shell, retained for runtime and type-level composition. */
    readonly parent: TParent;
    /** Tags this shell claims. */
    readonly ownTags: readonly TagsOf<TDefinitions>[];
    /** Tags this shell and every enclosing shell claim. */
    readonly claimedTags: readonly (TagsOf<TDefinitions> | (TParent extends AnyShell ? ClaimedBy<TParent> : never))[];
    readonly Provider: (props: TProps & {
        readonly children?: ReactNode;
    }) => ReactNode;
    /** The value this shell guarantees. Throws if the shell is not mounted. */
    use(): TValue;
    /** Aggregate view of what this shell is currently holding. */
    useHeld(): ShellHoldings<ErrorUnion<TDefinitions>>;
    useQuery<const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, ...rest: QueryHookArgs<TProcedureClient>): QueryState<ProcedureClientOutput<TProcedureClient>, SubtractClaimedErrors<ProcedureClientError<TProcedureClient>, ShellClaimedErrors<TDefinitions, TParent>>>;
    useSuspenseQuery<const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, ...rest: QueryHookArgs<TProcedureClient>): Exclude<QueryState<ProcedureClientOutput<TProcedureClient>, SubtractClaimedErrors<ProcedureClientError<TProcedureClient>, ShellClaimedErrors<TDefinitions, TParent>>>, {
        readonly state: "pending";
    }>;
    usePaginatedQuery<const TProcedureClient extends PaginatedProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: PaginatedClientListInput<NoInfer<TProcedureClient>>, options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>): PaginatedState<PaginatedClientItem<TProcedureClient>, SubtractClaimedErrors<ProcedureClientError<TProcedureClient>, ShellClaimedErrors<TDefinitions, TParent>>>;
    useMutation<const TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(procedure: NarrowProcedureClient<TProcedureClient>, options?: MutationOptions<ProcedureClientInput<TProcedureClient>, ProcedureClientOutput<TProcedureClient>, SubtractClaimedErrors<ProcedureClientError<TProcedureClient>, ShellClaimedErrors<TDefinitions, TParent>>, TContext>): MutationState<ProcedureClientInput<TProcedureClient>, ProcedureClientOutput<TProcedureClient>, SubtractClaimedErrors<ProcedureClientError<TProcedureClient>, ShellClaimedErrors<TDefinitions, TParent>>>;
    useSubscription<const TProcedureClient extends SubscriptionProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, ...rest: SubscriptionHookArgs<TProcedureClient>): SubscriptionState<SubscriptionClientOutput<TProcedureClient>, SubtractClaimedErrors<SubscriptionClientError<TProcedureClient>, ShellClaimedErrors<TDefinitions, TParent>>>;
}
export type ClaimedBy<TShell> = AnyShell extends TShell ? string : TShell extends {
    readonly claims: infer TDefinitions extends ErrorDefinitionMap;
    readonly parent: infer TParent;
} ? TagsOf<TDefinitions> | ClaimedBy<TParent> : never;
export type ClaimedErrorsBy<TShell> = AnyShell extends TShell ? AnyTaggedError : TShell extends {
    readonly claims: infer TDefinitions extends ErrorDefinitionMap;
    readonly parent: infer TParent;
} ? ErrorUnion<TDefinitions> | ClaimedErrorsBy<TParent> : never;
export type ValueOf<TShell> = TShell extends {
    use(): infer TValue;
} ? TValue : never;
export type ShellClaimCompatibility<TParent extends AnyShell | undefined, TDefinitions extends ErrorDefinitionMap> = TParent extends AnyShell ? [Extract<TagsOf<TDefinitions>, ClaimedBy<TParent>>] extends [never] ? unknown : RpcConstraintError<"shell-claim-already-owned-by-parent", Extract<TagsOf<TDefinitions>, ClaimedBy<TParent>>> : unknown;
export type DefineShellOptions<TDefinitions extends ErrorDefinitionMap, TParent extends AnyShell | undefined, TProps, TValue> = ShellCommonOptions<TDefinitions, TValue> & ShellParentOption<TParent> & ShellProviderOption<TProps, TValue> & ShellClaimCompatibility<TParent, TDefinitions>;
export type ShellParentOption<TParent extends AnyShell | undefined> = TParent extends AnyShell ? {
    readonly from: TParent;
} : {
    readonly from?: never;
};
export type ShellProviderOption<TProps, TValue> = {
    /** Builds the value guaranteed by this shell from its Provider props. */
    readonly provide: (props: TProps) => TValue;
} | ([TValue] extends [void] ? {
    readonly provide?: never;
} : never);
export type ShellCommonOptions<TDefinitions extends ErrorDefinitionMap, TValue> = {
    /** Used in mount diagnostics and devtools. */
    readonly name: string;
    /** The error definitions this shell claims. Pass the same map given to `.errors()`. */
    readonly claims: TDefinitions;
} & ({
    /** Pause is the default: the shell holds failures until `resume()`. */
    readonly effect?: "pause";
    /** Runs once per newly paused error. Recovery attempts may report again. */
    readonly onError?: (error: ErrorUnion<TDefinitions>, value: NoInfer<TValue>) => void;
} | {
    /** Delegates the exact tagged error to the nearest React error boundary. */
    readonly effect: "escalate";
    /** Escalation is observed by the React error boundary, not a shell reaction. */
    readonly onError?: never;
});
export type ProvidedShellOptions<TDefinitions extends ErrorDefinitionMap, TParent extends AnyShell | undefined, TProps, TValue> = ShellCommonOptions<TDefinitions, TValue> & ShellParentOption<TParent> & {
    readonly provide: (props: TProps) => TValue;
} & ShellClaimCompatibility<TParent, TDefinitions>;
export type VoidShellOptions<TDefinitions extends ErrorDefinitionMap, TParent extends AnyShell | undefined> = ShellCommonOptions<TDefinitions, void> & ShellParentOption<TParent> & {
    readonly provide?: never;
} & ShellClaimCompatibility<TParent, TDefinitions>;
/** A value-providing shell: its Provider props and value are inferred together. */
export declare function defineShell<const TDefinitions extends ErrorDefinitionMap, TProps, TValue, TParent extends AnyShell | undefined = undefined>(options: ProvidedShellOptions<TDefinitions, TParent, TProps, TValue>): Shell<TDefinitions, TParent, TProps, TValue>;
/** An error-only shell: it provides exactly `void`, never a caller-selected value. */
export declare function defineShell<const TDefinitions extends ErrorDefinitionMap, TParent extends AnyShell | undefined = undefined>(options: VoidShellOptions<TDefinitions, TParent>): Shell<TDefinitions, TParent, Record<never, never>, void>;
export type Exact<TLeft, TRight> = [TLeft] extends [TRight] ? [TRight] extends [TLeft] ? true : false : false;
export type LayerQueryProcedureClient<TValue> = QueryProcedureClientLike & ProcedureClientTypeCarrier<AnyProcedureClientTypes & {
    readonly input: EmptyObject;
    readonly output: TValue;
    readonly kind: "query";
    readonly capability: ClientUnaryTypes;
}>;
export type LayerProcedureCompatibility<TProcedureClient extends QueryProcedureClientLike, TValue, TDefinitions extends ErrorDefinitionMap> = (Exact<ProcedureClientOutput<TProcedureClient>, TValue> extends true ? unknown : RpcConstraintError<"layer-procedure-output-does-not-match-layer-value", {
    readonly expected: TValue;
    readonly actual: ProcedureClientOutput<TProcedureClient>;
}>) & (EmptyObject extends ProcedureClientInput<TProcedureClient> ? unknown : RpcConstraintError<"layer-procedure-requires-empty-input", ProcedureClientInput<TProcedureClient>>) & (ErrorUnion<TDefinitions> extends ProcedureClientError<TProcedureClient> ? unknown : RpcConstraintError<"layer-procedure-is-missing-layer-errors", Exclude<ErrorUnion<TDefinitions>, ProcedureClientError<TProcedureClient>>["_tag"]>);
export type LayerReactionError<TParent extends AnyShell, TProcedureClient extends QueryProcedureClientLike, TDefinitions extends ErrorDefinitionMap> = ErrorUnion<TDefinitions> | SubtractClaimedErrors<ProcedureClientError<TProcedureClient>, ClaimedErrorsBy<TParent>>;
export interface LayerShellCommonOptions<TParent extends AnyShell, TProcedureClient extends QueryProcedureClientLike, TValue, TDefinitions extends ErrorDefinitionMap> {
    /** Cache policy for the empty-input context query that establishes the layer. */
    readonly load?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>;
    /**
     * Fires when the layer cannot be established — a load failure the enclosing
     * layers did not claim — and when an operation inside the layer fails with
     * one of the layer's own tags. Must be idempotent.
     */
    readonly onError?: (error: LayerReactionError<NoInfer<TParent>, NoInfer<TProcedureClient>, TDefinitions>, value: TValue | undefined) => void;
}
/**
 * A layer procedure is either already available, or selected from the provider
 * client at render time. The distinct keys keep two callable values from being
 * distinguished by a runtime heuristic.
 */
export type LayerShellOptions<TParent extends AnyShell, TProcedureClient extends QueryProcedureClientLike, TValue, TDefinitions extends ErrorDefinitionMap, TClient = unknown> = LayerShellCommonOptions<TParent, TProcedureClient, TValue, TDefinitions> & {
    readonly from: TParent;
} & ({
    readonly procedure: NarrowProcedureClient<TProcedureClient>;
    readonly select?: never;
} | {
    readonly select: (client: TClient) => NarrowProcedureClient<TProcedureClient>;
    readonly procedure?: never;
}) & LayerProcedureCompatibility<TProcedureClient, TValue, TDefinitions> & ShellClaimCompatibility<TParent, TDefinitions>;
export interface LayerShellMetadata<TClient, TProcedureClient extends QueryProcedureClientLike, TKey extends string, TValue, TDefinitions extends ErrorDefinitionMap> {
    /** The shared declaration from which this shell was derived. */
    readonly layer: LayerShape<TKey, TValue, TDefinitions>;
    /** Selects the declaration's context procedure from a concrete client. */
    readonly resolveProcedure: (client: TClient) => NarrowProcedureClient<TProcedureClient>;
}
export interface LayerShellProviderProps {
    readonly children?: ReactNode;
    /** Rendered while the layer value loads and after an unrecoverable load failure. */
    readonly fallback?: ReactNode;
}
/** The globally registered, TanStack-style layer-shell constructor. */
export declare const layerShell: <TKey extends string, TValue, TDefinitions extends ErrorDefinitionMap, TProcedureClient extends LayerQueryProcedureClient<TValue>, TParent extends AnyShell>(layer: LayerShape<TKey, TValue, TDefinitions>, options: LayerShellOptions<TParent, TProcedureClient, TValue, TDefinitions, ReturnType<typeof useResultClient>>) => Shell<TDefinitions, TParent, LayerShellProviderProps, TValue> & LayerShellMetadata<unknown, TProcedureClient, TKey, TValue, TDefinitions>;
/** A layer-shell constructor bound to one concrete client environment. */
export type LayerShellFactory<TClient> = <TKey extends string, TValue, TDefinitions extends ErrorDefinitionMap, TProcedureClient extends LayerQueryProcedureClient<TValue>, TParent extends AnyShell>(layer: LayerShape<TKey, TValue, TDefinitions>, options: LayerShellOptions<TParent, TProcedureClient, TValue, TDefinitions, TClient>) => Shell<TDefinitions, TParent, LayerShellProviderProps, TValue> & LayerShellMetadata<TClient, TProcedureClient, TKey, TValue, TDefinitions>;
/** Internal building block for `createResultRpcReact<TClient>()`. */
export declare function bindLayerShell<TClient>(useClient: () => TClient): LayerShellFactory<TClient>;
export interface AnyLayerShell extends AnyShell {
    readonly layer: AnyLayer;
    /** The exact LayerShellMetadata carrier is required before this can be called. */
    readonly resolveProcedure: (client: never) => QueryProcedureClientLike;
    readonly Provider: (props: LayerShellProviderProps) => ReactNode;
}
export type LayerShellClient<TShell> = TShell extends LayerShellMetadata<infer TClient, infer _TProcedureClient, infer _TKey, infer _TValue, infer _TDefinitions> ? TClient : never;
export type LayerShellProcedure<TShell> = TShell extends LayerShellMetadata<infer _TClient, infer TProcedureClient, infer _TKey, infer _TValue, infer _TDefinitions> ? TProcedureClient : never;
/** Prefetches the empty-input context procedure retained by a typed layer shell. */
export declare const prefetchLayer: <TShell extends AnyLayerShell>(runtime: QueryRuntime<LayerShellClient<TShell>>, shell: TShell, client: LayerShellClient<TShell>) => Promise<ProcedureClientResult<LayerShellProcedure<TShell>>>;

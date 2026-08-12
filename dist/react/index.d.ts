import { type ReactNode, type SuspenseProps } from "react";
import type { AnyTaggedError } from "../error.js";
import type { EmptyObject } from "../wire.js";
import { type LayerShellFactory } from "./shell.js";
import type { PaginatedClientItem, PaginatedClientListInput, PaginatedProcedureClientLike, PaginatedState, ProcedureClientError, ProcedureClientInput, ProcedureClientOutput, MutationOptions, MutationProcedureClientLike, MutationState, NarrowProcedureClient, QueryOptions, QueryProcedureClientLike, QueryRuntime, QueryState, SubscriptionClientError, SubscriptionClientInput, SubscriptionClientOutput, SubscriptionProcedureClientLike, SubscriptionState, SubscriptionOptions, DehydratedQueryRuntime } from "../query/runtime.js";
export { SERIALIZER_VERSION, toResult } from "../query/runtime.js";
export type { AnyModel, AnyProcedure, AnyProcedureContract, AnySubscriptionProcedure, AnyUnaryProcedure, AnyProcedureClientTypes, ClientPaginationTypes, ClientProcedure, ClientProcedureCapability, ClientProcedureError, ClientProcedureInput, ClientProcedureOutput, ProcedureClientTypeCarrier, ClientProcedureTypes, ClientUnaryTypes, CreateQueryRuntimeOptions, DehydratedQueryRuntime, FetchState, MutationOptions, MutationProcedureClientLike, MutationState, MutationStateOf, NarrowProcedureClient, IsUnion, ModelKeyInput, ModelDefinition, ModelIdentityField, ModelKeyRecord, ModelProjection, ModelValue, KeyField, ModelSourceMismatch, ModelTypeCompatible, ModelTypeEqual, MutableModelType, MismatchedSourceFields, PrintModelType, PrintModelScalar, HasStrictNullChecks, NullabilityCaveat, SourceFieldMessage, SelectedOwnFields, SelectionInput, SelectionValue, ShapeKeySpec, SpecificModelKeyInput, MutationControls, MaybePromise, PaginatedClientCursor, PaginatedClientItem, PaginatedClientListInput, PaginatedProcedureClientLike, PaginatedState, PaginatedStateOf, PaginatedControls, Page, PageRequest, ProcedureClientConstraint, ProcedureClientError, ProcedureClientInput, ProcedureClientLike, ProcedureClientOutput, ProcedureClientResult, QueryControls, QueryProcedureClientLike, QueryCache, QueryOptions, QueryRuntime, QueryState, QueryStateOf, Result, ResultMutationObserver, ResultPaginatedObserver, ResultQueryKey, ResultQueryObserver, ResultSubscriptionObserver, RpcConstraintError, RuntimeCallOptions, RuntimeMiddleware, SubscriptionConnection, SubscriptionOptions, SubscriptionProcedureClientLike, SubscriptionClientError, SubscriptionClientInput, SubscriptionClientOutput, SubscriptionState, SubscriptionStateOf, EffectiveContractVersion, ErasedMiddlewareHandler, } from "../query/runtime.js";
export { defineShell, layerShell, prefetchLayer } from "./shell.js";
export type * from "./shell.js";
export { boundaryShells } from "./boundary.js";
export type * from "./boundary.js";
export type { BoundaryShells, BoundaryShellsOptions, Connectivity, ConnectivityStatus, } from "./boundary.js";
export type { AnyLayer, LayerShape } from "../layer.js";
export type { ErrorDefinitionMap, ErrorUnion } from "../error-map.js";
export type { AnyPublicErrorDefinition, AnyErrorDefinition, AnyPublicTaggedError, AnyTaggedError, EncodedTaggedError, ErrorDefinition, ErrorOf, ErrorPolicy, ErrorPolicyBase, ErrorSeverity, ErrorVisibility, RetryPolicy, TaggedError, } from "../error.js";
export type { AffectsEntry, AnyProcedureTypes, PaginationManifest, ProcedureKind, ProcedureTypeCarrier, QueryAffectsTarget, WritesEntry, } from "../procedure-types.js";
export type { PaginatedProcedureCapability, ProcedureCapability, UnaryProcedureCapability, } from "../procedure-capability.js";
export type { ClaimRegistry } from "./claims.js";
export type { Err, Ok } from "../result.js";
export type { AnyWireCodec, CodecIssue, CodecShape, DecodeResult, EmptyObject, InputOf, OptionalShapeKeys, RequiredShapeKeys, ShapeInput, WireCodec, WireScalar, WireTypedArray, WireValue, } from "../wire.js";
export { ClientStale, defectErrors, staleErrors, transportErrors } from "../framework-errors.js";
/** Zero-input procedures may omit the input argument entirely. */
export type QueryHookArgs<TProcedureClient extends QueryProcedureClientLike> = EmptyObject extends ProcedureClientInput<NoInfer<TProcedureClient>> ? [
    input?: ProcedureClientInput<NoInfer<TProcedureClient>>,
    options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>
] : [
    input: ProcedureClientInput<NoInfer<TProcedureClient>>,
    options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>
];
/** Zero-input subscriptions may omit the input argument entirely. */
export type SubscriptionHookArgs<TProcedureClient extends SubscriptionProcedureClientLike> = EmptyObject extends SubscriptionClientInput<NoInfer<TProcedureClient>> ? [
    input?: SubscriptionClientInput<NoInfer<TProcedureClient>>,
    options?: SubscriptionOptions<SubscriptionClientError<NoInfer<TProcedureClient>>>
] : [
    input: SubscriptionClientInput<NoInfer<TProcedureClient>>,
    options?: SubscriptionOptions<SubscriptionClientError<NoInfer<TProcedureClient>>>
];
export type { AnyShell, AnyLayerShell, DefineShellOptions, SubtractClaimedErrors, ClaimedBy, ClaimedErrorsBy, Shell, ShellHoldings, ShellEffect, LayerShellOptions, LayerShellFactory, LayerShellClient, LayerShellMetadata, LayerShellProcedure, LayerShellProviderProps, TagsOf, ValueOf, } from "./shell.js";
/**
 * Application-wide type registration, following TanStack's framework pattern.
 * Augment this interface once in an application to make `useResultClient()`
 * return its concrete client without a call-site type argument.
 */
export interface Register {
}
export type RegisteredClient = Register extends {
    readonly client: infer TClient;
} ? TClient : unknown;
export type RegisteredProviderClient = RegisteredClient extends object ? RegisteredClient : object;
export type ResultRpcProviderProps<TClient extends object = object> = ({
    readonly runtime: QueryRuntime<TClient>;
    readonly client?: undefined;
} | {
    readonly client: TClient;
    readonly runtime?: undefined;
}) & {
    /** SSR-dehydrated cache state, applied once per distinct value. */
    readonly hydrate?: DehydratedQueryRuntime;
    readonly children?: ReactNode;
};
/** Provider constrained to the globally registered client, when one exists. */
export declare const ResultRpcProvider: (props: ResultRpcProviderProps<RegisteredProviderClient>) => ReactNode;
/** The enclosing provider's runtime, for imperative cache operations. */
export declare const useResultRuntime: () => QueryRuntime<RegisteredClient>;
export interface ResultRpcHydrationBoundaryProps {
    /**
     * Cache state produced on the server by `runtime.dehydrate()`. It is a plain
     * JSON-serializable object (a version stamp plus a string payload), so it
     * crosses the RSC server→client boundary as an ordinary prop.
     */
    readonly state?: DehydratedQueryRuntime;
    readonly children?: ReactNode;
}
/**
 * Merges server-prefetched cache state into the enclosing runtime — the App
 * Router idiom. Unlike the provider's one-shot `hydrate` prop, a boundary is
 * nestable: each route segment's server component can prefetch, dehydrate, and
 * render its own boundary, and every payload merges into the one client
 * runtime. Hydrated entities are indexed exactly as fetched ones are, so a
 * client mutation patches server-rendered rows with zero refetch.
 *
 * Hydration happens during render (before children read the cache, so the
 * first paint has the data), once per distinct `state`, and never crashes the
 * tree: a serializer/contract-version mismatch across a deploy is skipped with
 * a dev warning and the client fetches fresh.
 */
export declare const ResultRpcHydrationBoundary: (props: ResultRpcHydrationBoundaryProps) => import("react").FunctionComponentElement<import("react").FragmentProps>;
/**
 * The client registered by the application and supplied to the enclosing
 * ResultRpcProvider.
 *
 *     declare module "result-rpc/react" {
 *       interface Register { client: AppClient }
 *     }
 *
 *     const client = useResultClient()
 */
export declare const useResultClient: () => RegisteredClient;
/** React bindings scoped to one generated client type. */
export interface ResultRpcReact<TClient extends object> {
    readonly ResultRpcProvider: (props: ResultRpcProviderProps<TClient>) => ReactNode;
    readonly useResultClient: () => TClient;
    readonly useResultRuntime: () => QueryRuntime<TClient>;
    readonly layerShell: LayerShellFactory<TClient>;
}
/**
 * A scoped binding for repositories that compile several independent apps in
 * one TypeScript program. Normal applications can use `Register`; this binds
 * the same guarantees without global declaration merging.
 */
export declare const createResultRpcReact: <TClient extends object>() => Readonly<ResultRpcReact<TClient>>;
export declare const useResultQuery: <const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, ...rest: QueryHookArgs<TProcedureClient>) => QueryState<ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>>;
/**
 * Observes a `.paginate()` procedure: one cache entry per list input, every
 * loaded page flattened into `rows` (deduplicated by entity identity),
 * `fetchNext()` to extend, `refetch()` to sequentially converge the whole
 * loaded window. Ambient shells claim failures exactly like `useResultQuery`;
 * use `Shell.usePaginatedQuery` when the return type should subtract them too.
 */
export declare const useResultPaginatedQuery: <const TProcedureClient extends PaginatedProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: PaginatedClientListInput<NoInfer<TProcedureClient>>, options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>) => PaginatedState<PaginatedClientItem<TProcedureClient>, ProcedureClientError<TProcedureClient>>;
export type SuspenseQueryState<T, E extends AnyTaggedError> = Exclude<QueryState<T, E>, {
    readonly state: "pending";
}>;
export interface ResultSuspenseProps extends SuspenseProps {
    /** Replaces the claim lease when a conditional subtree changes identity. */
    readonly resetKey?: unknown;
}
/**
 * Suspense plus a committed lifecycle owner for shell-claimed failures.
 * A child that suspends before commit cannot install its own cleanup, so a
 * result-rpc suspense query which may be claimed belongs inside this boundary.
 */
export declare const ResultSuspense: ({ resetKey, children, ...props }: ResultSuspenseProps) => import("react").FunctionComponentElement<SuspenseProps>;
export declare const useResultSuspenseQuery: <const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, ...rest: QueryHookArgs<TProcedureClient>) => SuspenseQueryState<ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>>;
export declare const useResultMutation: <const TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(procedure: NarrowProcedureClient<TProcedureClient>, options?: MutationOptions<ProcedureClientInput<TProcedureClient>, ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>, TContext>) => MutationState<ProcedureClientInput<TProcedureClient>, ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>>;
export declare const useResultSubscription: <const TProcedureClient extends SubscriptionProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, ...rest: SubscriptionHookArgs<TProcedureClient>) => SubscriptionState<SubscriptionClientOutput<TProcedureClient>, SubscriptionClientError<TProcedureClient>>;

import { type AnyTaggedError } from "../error.js";
import type { EffectiveContractVersion } from "../contract-digest.js";
import { type Result } from "../result.js";
import { SERIALIZER_VERSION } from "../serializer.js";
import type { Page, PageRequest } from "../server/contract.js";
import { type AnyModel, type ModelKeyInput, type ModelProjection, type ModelValue } from "../model.js";
import type { AnyProcedureClientTypes, ClientPaginationTypes, ClientUnaryTypes, ClientProcedureError, ClientProcedureInput, ClientProcedureOutput, ProcedureClientTypeCarrier } from "../client/base-client.js";
import type { RpcConstraintError } from "../type-diagnostics.js";
export type * from "../client/base-client.js";
export type { EffectiveContractVersion } from "../contract-digest.js";
export type * from "../error.js";
export type { AnyModel, ModelDefinition, ModelIdentityField, ModelKeyInput, ModelKeyRecord, ModelSourceMismatch, ModelTypeCompatible, ModelTypeEqual, MutableModelType, MismatchedSourceFields, PrintModelType, PrintModelScalar, HasStrictNullChecks, NullabilityCaveat, SourceFieldMessage, ModelProjection, ModelValue, KeyField, SelectedOwnFields, SelectionInput, SelectionValue, ShapeKeySpec, SpecificModelKeyInput, } from "../model.js";
export type * from "../result.js";
export type { AnyProcedure, AnyProcedureContract, AnyRouter, AnyRouterContract, AnySubscriptionProcedure, AnyUnaryProcedure, ContractRouterRecord, ErrorUnion, ErasedMiddlewareHandler, Page, PageRequest, ProcedureTypesOf, RouterRecord, RouterRecordOf, Router, RouterContract, RouterTypes, RouterTypesOf, RuntimeMiddleware, } from "../server/contract.js";
export type * from "../procedure-types.js";
export type * from "../procedure-capability.js";
export type { ErrorDefinitionMap } from "../error-map.js";
export type { RpcConstraintError } from "../type-diagnostics.js";
export type { MaybePromise } from "../types.js";
export type { AnyWireCodec, CodecIssue, CodecShape, DecodeResult, EmptyObject, EncodedOf, InputOf, OptionalShapeKeys, RequiredShapeKeys, ShapeInput, WireCodec, WireScalar, WireTypedArray, WireValue, } from "../wire.js";
export { SERIALIZER_VERSION } from "../serializer.js";
export type ResultQueryKey = readonly [path: string, encodedInput: string];
export type RuntimeCallOptions = {
    readonly signal?: AbortSignal;
};
export type ProcedureClientConstraint<TTypes extends AnyProcedureClientTypes, TResult> = ((input: never, options?: RuntimeCallOptions) => TResult) & ProcedureClientTypeCarrier<TTypes>;
export type ProcedureClientLike = ProcedureClientConstraint<AnyProcedureClientTypes & {
    readonly kind: "query" | "mutation";
    readonly capability: ClientUnaryTypes;
}, Promise<Result<unknown, AnyTaggedError>>>;
export type QueryProcedureClientLike = ProcedureClientConstraint<AnyProcedureClientTypes & {
    readonly kind: "query";
    readonly capability: ClientUnaryTypes;
}, Promise<Result<unknown, AnyTaggedError>>>;
export type MutationProcedureClientLike = ProcedureClientConstraint<AnyProcedureClientTypes & {
    readonly kind: "mutation";
    readonly capability: ClientUnaryTypes;
}, Promise<Result<unknown, AnyTaggedError>>>;
export type SubscriptionProcedureClientLike = ProcedureClientConstraint<AnyProcedureClientTypes & {
    readonly kind: "subscription";
    readonly capability: ClientUnaryTypes;
}, unknown>;
export type SubscriptionClientInput<TProcedureClient> = ClientProcedureInput<TProcedureClient>;
export type SubscriptionClientOutput<TProcedureClient> = ClientProcedureOutput<TProcedureClient>;
export type SubscriptionClientError<TProcedureClient> = ClientProcedureError<TProcedureClient>;
export type ProcedureClientInput<TProcedureClient> = ClientProcedureInput<TProcedureClient>;
export type ProcedureClientResult<TProcedureClient> = Result<ClientProcedureOutput<TProcedureClient>, ClientProcedureError<TProcedureClient>>;
export type ProcedureClientOutput<TProcedureClient> = ClientProcedureOutput<TProcedureClient>;
export type ProcedureClientError<TProcedureClient> = ClientProcedureError<TProcedureClient>;
export type IsUnion<TValue, TWhole = TValue> = TValue extends TWhole ? [TWhole] extends [TValue] ? false : true : never;
/**
 * Procedure and input are one associated fact. A value that still represents
 * several procedures must be narrowed before entering an operation API;
 * otherwise TypeScript independently unions their inputs and admits an
 * impossible pair.
 */
export type NarrowProcedureClient<TProcedureClient> = true extends IsUnion<TProcedureClient> ? TProcedureClient & RpcConstraintError<"procedure-union-must-be-narrowed", TProcedureClient> : TProcedureClient;
/** A client function minted for a `.paginate()` procedure. */
export type PaginatedProcedureClientLike = ProcedureClientConstraint<AnyProcedureClientTypes & {
    readonly input: PageRequest<unknown, unknown>;
    readonly output: Page<unknown, unknown>;
    readonly kind: "query";
    readonly capability: ClientPaginationTypes<unknown, unknown, unknown>;
}, Promise<Result<unknown, AnyTaggedError>>>;
export type PaginatedClientListInput<TProcedureClient> = ClientProcedureInput<TProcedureClient> extends PageRequest<infer TListInput, infer _TCursor> ? TListInput : never;
export type PaginatedClientCursor<TProcedureClient> = ClientProcedureInput<TProcedureClient> extends PageRequest<infer _TListInput, infer TCursor> ? TCursor : never;
export type PaginatedClientItem<TProcedureClient> = ClientProcedureOutput<TProcedureClient> extends Page<infer TItem, infer _TCursor> ? TItem : never;
export type FetchState = "idle" | "fetching" | "paused";
export interface QueryControls {
    readonly fetch: FetchState;
    readonly failureCount: number;
    readonly isStale: boolean;
    readonly updatedAt: number;
    /** Starts a fresh fetch. Observe the returned state through this observer/hook. */
    readonly refetch: () => Promise<void>;
}
export type QueryState<T, E extends AnyTaggedError> = (QueryControls & Readonly<{
    state: "pending";
    value?: undefined;
    error?: undefined;
}>) | (QueryControls & Readonly<{
    state: "success";
    value: T;
    error?: undefined;
}>) | (QueryControls & Readonly<{
    state: "failure";
    error: E;
    value?: undefined;
    previous?: T;
}>);
export interface QueryOptions<in E extends AnyTaggedError> {
    readonly enabled?: boolean;
    readonly staleTime?: number;
    readonly gcTime?: number;
    readonly retry?: false | number | ((error: E, failureCount: number) => boolean) | undefined;
}
export interface ResultQueryObserver<out T, out E extends AnyTaggedError> {
    readonly key: ResultQueryKey;
    readonly getCurrentState: () => QueryState<T, E>;
    readonly subscribe: (listener: () => void) => () => void;
    readonly refetch: () => Promise<QueryState<T, E>>;
    readonly destroy: () => void;
}
export interface PaginatedControls {
    readonly fetch: FetchState;
    readonly failureCount: number;
    readonly isStale: boolean;
    readonly updatedAt: number;
    readonly pageCount: number;
    /** Whether the last loaded page carried a non-null `nextCursor`. */
    readonly hasNext: boolean;
    readonly fetchingNext: boolean;
    /** Sequentially refetches EVERY loaded page — the whole list converges. */
    readonly refetch: () => Promise<void>;
    /** Loads the next page; a no-op while already fetching or exhausted. */
    readonly fetchNext: () => Promise<void>;
}
/**
 * The state of a paginated query: every loaded page flattened into `rows`,
 * deduplicated by entity identity (a row that drifted across a page boundary
 * between fetches appears once — its fields stay fresh via entity patches
 * regardless of which page carried it).
 */
export type PaginatedState<TItem, E extends AnyTaggedError> = (PaginatedControls & Readonly<{
    state: "pending";
    rows?: undefined;
    error?: undefined;
}>) | (PaginatedControls & Readonly<{
    state: "success";
    rows: readonly TItem[];
    error?: undefined;
}>) | (PaginatedControls & Readonly<{
    state: "failure";
    error: E;
    rows?: undefined;
    previous?: readonly TItem[];
}>);
export interface ResultPaginatedObserver<out TItem, out E extends AnyTaggedError> {
    readonly key: ResultQueryKey;
    readonly getCurrentState: () => PaginatedState<TItem, E>;
    readonly subscribe: (listener: () => void) => () => void;
    readonly refetch: () => Promise<PaginatedState<TItem, E>>;
    readonly fetchNext: () => Promise<PaginatedState<TItem, E>>;
    readonly destroy: () => void;
}
export interface MutationControls<TInput, TOutput, TError extends AnyTaggedError> {
    readonly variables?: TInput;
    /**
     * Fire-and-forget. Never rejects, so an event handler can call it without a
     * floating promise — the outcome is read from this state, which is where a
     * caller that ignores the return value was always going to read it.
     */
    readonly mutate: (input: TInput) => void;
    /**
     * The awaited form, for a caller that continues on the outcome. Rejects with
     * the `claimed` signal when a mounted shell owns the failure, so the
     * continuation does not run on an outcome someone else has taken
     * responsibility for.
     */
    readonly mutateAsync: (input: TInput) => Promise<Result<TOutput, TError>>;
    readonly cancel: () => void;
    readonly reset: () => void;
}
export type MutationState<TInput, TOutput, TError extends AnyTaggedError> = (MutationControls<TInput, TOutput, TError> & Readonly<{
    state: "idle";
    value?: undefined;
    error?: undefined;
}>) | (MutationControls<TInput, TOutput, TError> & Readonly<{
    state: "pending";
    value?: undefined;
    error?: undefined;
    variables: TInput;
}>) | (MutationControls<TInput, TOutput, TError> & Readonly<{
    state: "success";
    value: TOutput;
    error?: undefined;
    variables: TInput;
}>) | (MutationControls<TInput, TOutput, TError> & Readonly<{
    state: "failure";
    error: TError;
    value?: undefined;
    variables: TInput;
}>);
export interface MutationOptions<in TInput, in TOutput, in TError extends AnyTaggedError, in out TContext = undefined> {
    readonly retry?: false | number | ((error: TError, failureCount: number) => boolean) | undefined;
    readonly optimistic?: (input: TInput, cache: QueryCache) => TContext | undefined | Promise<TContext | undefined>;
    readonly onSuccess?: (value: TOutput, input: TInput) => void | Promise<void>;
    readonly onFailure?: (error: TError, input: TInput, context: TContext | undefined, cache: QueryCache) => void | Promise<void>;
    /**
     * Cleans up local optimistic work when control flow interrupts the consumer:
     * an explicit cancellation, a mounted React shell claiming the failure, or
     * a shell definition-identity mismatch failing loudly before typed failure
     * callbacks. The rejected mutation promise distinguishes `cancelled` from
     * `claimed`; a definition mismatch rejects with its diagnostic `TypeError`.
     */
    readonly onCancel?: (input: TInput, context: TContext | undefined, cache: QueryCache) => void | Promise<void>;
    readonly onSettled?: (result: Result<TOutput, TError>, input: TInput, context: TContext | undefined, cache: QueryCache) => void | Promise<void>;
}
export interface QueryCache {
    key<const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: ProcedureClientInput<NoInfer<TProcedureClient>>): ResultQueryKey;
    get<const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: ProcedureClientInput<NoInfer<TProcedureClient>>): ProcedureClientOutput<TProcedureClient> | undefined;
    update<const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: ProcedureClientInput<NoInfer<TProcedureClient>>, updater: (current: ProcedureClientOutput<TProcedureClient> | undefined) => ProcedureClientOutput<TProcedureClient> | undefined): () => void;
    invalidate<const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: ProcedureClientInput<NoInfer<TProcedureClient>>): Promise<void>;
    invalidateAll<const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>): Promise<void>;
    /** Invalidates every cached query whose result contains the entity. */
    invalidateEntity<TModel extends AnyModel>(model: TModel, id: ModelKeyInput<TModel>): Promise<void>;
    /**
     * Patches the entity in place everywhere it appears — one call updates the
     * detail view, every list row, the header. The updater receives the cached
     * value as an identity-bearing projection: non-key model fields are optional.
     * Its partial result is merged by the projection rule. Returns a rollback,
     * composing with `optimistic:` exactly like `update`.
     */
    updateEntity<TModel extends AnyModel>(model: TModel, id: ModelKeyInput<TModel>, updater: (current: ModelProjection<TModel>) => Partial<ModelValue<TModel>>): () => void;
}
export interface ResultMutationObserver<TInput, TOutput, TError extends AnyTaggedError> {
    readonly getCurrentState: () => MutationState<TInput, TOutput, TError>;
    readonly subscribe: (listener: () => void) => () => void;
    /** Fire-and-forget; the outcome is read from `getCurrentState()`. */
    readonly mutate: (input: TInput) => void;
    readonly mutateAsync: (input: TInput) => Promise<Result<TOutput, TError>>;
    readonly cancel: () => void;
    readonly reset: () => void;
    readonly destroy: () => void;
}
export type SubscriptionConnection = "connecting" | "open" | "reconnecting" | "paused" | "closed";
export interface SubscriptionOptions<in E extends AnyTaggedError> {
    readonly retry?: false | number | ((error: E, failureCount: number) => boolean) | undefined;
    readonly retryDelayMs?: number | ((failureCount: number) => number) | undefined;
}
export interface SubscriptionState<out T, out E extends AnyTaggedError> {
    readonly connection: SubscriptionConnection;
    readonly result: Result<T, E> | undefined;
    readonly eventCount: number;
    readonly reconnect: () => void;
    readonly close: () => void;
}
/** Hook/observer state derived directly from a concrete query client procedure. */
export type QueryStateOf<TProcedureClient extends QueryProcedureClientLike> = QueryState<ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>>;
/** Paginated state derived directly from a concrete paginated client procedure. */
export type PaginatedStateOf<TProcedureClient extends PaginatedProcedureClientLike> = PaginatedState<PaginatedClientItem<TProcedureClient>, ProcedureClientError<TProcedureClient>>;
/** Mutation state derived directly from a concrete mutation client procedure. */
export type MutationStateOf<TProcedureClient extends MutationProcedureClientLike> = MutationState<ProcedureClientInput<TProcedureClient>, ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>>;
/** Subscription state derived directly from a concrete subscription client procedure. */
export type SubscriptionStateOf<TProcedureClient extends SubscriptionProcedureClientLike> = SubscriptionState<SubscriptionClientOutput<TProcedureClient>, SubscriptionClientError<TProcedureClient>>;
export interface ResultSubscriptionObserver<out T, out E extends AnyTaggedError> {
    readonly getCurrentState: () => SubscriptionState<T, E>;
    readonly subscribe: (listener: () => void) => () => void;
    readonly reconnect: () => void;
    readonly close: () => void;
}
/**
 * Re-wraps a settled query or mutation state as the same `Result` the
 * imperative client returns — for handing a hook outcome to Result-typed
 * code. `undefined` while the state is still pending or idle.
 */
export declare function toResult<T, E extends AnyTaggedError>(state: QueryState<T, E>): Result<T, E> | undefined;
export declare function toResult<TInput, TOutput, TError extends AnyTaggedError>(state: MutationState<TInput, TOutput, TError>): Result<TOutput, TError> | undefined;
export interface CreateQueryRuntimeOptions<TClient> {
    readonly client: TClient;
}
export interface DehydratedQueryRuntime {
    readonly v: 1;
    readonly serializer: typeof SERIALIZER_VERSION;
    readonly contract: EffectiveContractVersion;
    readonly payload: string;
}
export interface QueryRuntime<TClient = unknown> {
    /** The client this runtime was created with. */
    readonly client: TClient;
    readonly cache: QueryCache;
    observe<const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: ProcedureClientInput<NoInfer<TProcedureClient>>, options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>): ResultQueryObserver<ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>>;
    prefetch<const TProcedureClient extends QueryProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: ProcedureClientInput<NoInfer<TProcedureClient>>, options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>): Promise<ProcedureClientResult<TProcedureClient>>;
    observePaginated<const TProcedureClient extends PaginatedProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: PaginatedClientListInput<NoInfer<TProcedureClient>>, options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>): ResultPaginatedObserver<PaginatedClientItem<TProcedureClient>, ProcedureClientError<TProcedureClient>>;
    /** Warms the first page; loaders and SSR use this. */
    prefetchPaginated<const TProcedureClient extends PaginatedProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: PaginatedClientListInput<NoInfer<TProcedureClient>>, options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>): Promise<Result<readonly PaginatedClientItem<TProcedureClient>[], ProcedureClientError<TProcedureClient>>>;
    mutation<const TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(procedure: NarrowProcedureClient<TProcedureClient>, options?: MutationOptions<ProcedureClientInput<TProcedureClient>, ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>, TContext>): ResultMutationObserver<ProcedureClientInput<TProcedureClient>, ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>>;
    subscription<const TProcedureClient extends SubscriptionProcedureClientLike>(procedure: NarrowProcedureClient<TProcedureClient>, input: SubscriptionClientInput<NoInfer<TProcedureClient>>, options?: SubscriptionOptions<SubscriptionClientError<NoInfer<TProcedureClient>>>): ResultSubscriptionObserver<SubscriptionClientOutput<TProcedureClient>, SubscriptionClientError<TProcedureClient>>;
    dehydrate(): DehydratedQueryRuntime;
    hydrate(state: DehydratedQueryRuntime): void;
    clear(): void;
}
export declare const createQueryRuntime: <TClient>(options: CreateQueryRuntimeOptions<TClient>) => QueryRuntime<TClient>;

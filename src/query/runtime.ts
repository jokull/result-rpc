import {
  CancelledError,
  dehydrate as dehydrateQueryClient,
  hydrate as hydrateQueryClient,
  InfiniteQueryObserver,
  MutationObserver,
  onlineManager,
  QueryClient,
  QueryObserver,
  type InfiniteData,
  type QueryObserverResult,
  type MutationObserverResult,
} from "@tanstack/query-core";
import { isTaggedError, type AnyTaggedError } from "../error.js";
import { frameworkErrorDefinitions } from "../framework-errors.js";
import { getOnlineSnapshot, subscribeConnectivity } from "../connectivity.js";
import type { EffectiveContractVersion } from "../contract-digest.js";

/**
 * Make the shared connectivity source the single event source for
 * query-core's online manager, and seed its initial state (the manager boots
 * assuming online and its default setup listens on `window`, which React
 * Native and test runtimes lack). Accurate state is the anti-thrash lever:
 * with the default `networkMode: "online"`, fetches and retries *pause*
 * while offline instead of failing instantly and burning the retry budget.
 */
let onlineManagerWired = false;
const wireOnlineManager = () => {
  if (onlineManagerWired) return;
  onlineManagerWired = true;
  onlineManager.setEventListener((setOnline) => {
    setOnline(getOnlineSnapshot());
    return subscribeConnectivity((event) => {
      if (event === "online") setOnline(true);
      if (event === "offline") setOnline(false);
    });
  });
};
import { err, ok, type Result } from "../result.js";
import { encodeProcedureInput } from "../wire.js";
import {
  DEFAULT_MAX_WIRE_BYTES,
  deserialize,
  serialize,
  SERIALIZER_VERSION,
} from "../serializer.js";
import {
  getClientIdentity,
  getClientContractVersion,
  getClientRouter,
  getProcedureClientMetadata,
  getTouchedEntities,
} from "../client/client-metadata.js";
import type {
  AffectsEntry,
  Page,
  PageRequest,
  PaginationManifest,
  WritesEntry,
} from "../server/contract.js";
import {
  collectEntities,
  entityBrandOf,
  entityIdFor,
  entityIdOf,
  entityKey,
  isEntityRecord,
  mergeByExistingKeys,
  patchEntity,
  shareStructural,
  type AnyModel,
  type EntityCacheKey,
  type EntityId,
  type ModelKeyInput,
  type ModelProjection,
  type ModelValue,
} from "../model.js";
import type { ResultSubscription } from "../client/client.js";
import type {
  AnyProcedureClientTypes,
  ClientPaginationTypes,
  ClientUnaryTypes,
  ClientProcedureError,
  ClientProcedureInput,
  ClientProcedureOutput,
  ClientProcedureSource,
  ProcedureClientTypeCarrier,
} from "../client/base-client.js";
import { isCancelled } from "../client/transport.js";
import type { ErrorDefinitionMap } from "../server/contract.js";
import type { RpcConstraintError } from "../type-diagnostics.js";
import { definitionFor, shouldRetryMutation } from "./mutation-retry.js";

export type * from "../client/base-client.js";
export type { EffectiveContractVersion } from "../contract-digest.js";
export type * from "../error.js";
export type {
  AnyModel,
  ModelDefinition,
  ModelIdentityField,
  ModelKeyInput,
  ModelKeyRecord,
  ModelSourceMismatch,
  ModelTypeCompatible,
  ModelTypeEqual,
  MutableModelType,
  MismatchedSourceFields,
  PrintModelType,
  SourceFieldMessage,
  ModelProjection,
  ModelValue,
  KeyField,
  SelectedOwnFields,
  SelectionInput,
  SelectionValue,
  ShapeKeySpec,
  SpecificModelKeyInput,
} from "../model.js";
export type * from "../result.js";
export type {
  AnyProcedure,
  AnyProcedureContract,
  AnyRouter,
  AnyRouterContract,
  AnySubscriptionProcedure,
  AnyUnaryProcedure,
  ContractRouterRecord,
  ErrorUnion,
  ErasedMiddlewareHandler,
  Page,
  PageRequest,
  ProcedureTypesOf,
  RouterRecord,
  RouterRecordOf,
  Router,
  RouterContract,
  RouterTypes,
  RouterTypesOf,
  RuntimeMiddleware,
} from "../server/contract.js";
export type * from "../procedure-types.js";
export type * from "../procedure-capability.js";
export type { ErrorDefinitionMap } from "../error-map.js";
export type { RpcConstraintError } from "../type-diagnostics.js";
export type { MaybePromise } from "../types.js";
export type {
  AnyWireCodec,
  CodecIssue,
  CodecShape,
  DecodeResult,
  EmptyObject,
  EncodedOf,
  InputOf,
  OptionalShapeKeys,
  RequiredShapeKeys,
  ShapeInput,
  WireCodec,
  WireScalar,
  WireTypedArray,
  WireValue,
} from "../wire.js";
export { SERIALIZER_VERSION } from "../serializer.js";
export type ResultQueryKey = readonly [path: string, encodedInput: string];

export type RuntimeCallOptions = { readonly signal?: AbortSignal };

export type ProcedureClientConstraint<TTypes extends AnyProcedureClientTypes, TResult> = ((
  input: never,
  options?: RuntimeCallOptions,
) => TResult) &
  ProcedureClientTypeCarrier<TTypes>;

// Runtime-facing constraints carry only associated facts. Their `never` input
// makes every concrete generated callable assignable without letting an
// erased consumer invent an input value.
export type ProcedureClientLike = ProcedureClientConstraint<
  AnyProcedureClientTypes & {
    readonly kind: "query" | "mutation";
    readonly capability: ClientUnaryTypes;
  },
  Promise<Result<unknown, AnyTaggedError>>
>;
export type QueryProcedureClientLike = ProcedureClientConstraint<
  AnyProcedureClientTypes & { readonly kind: "query"; readonly capability: ClientUnaryTypes },
  Promise<Result<unknown, AnyTaggedError>>
>;
export type MutationProcedureClientLike = ProcedureClientConstraint<
  AnyProcedureClientTypes & { readonly kind: "mutation"; readonly capability: ClientUnaryTypes },
  Promise<Result<unknown, AnyTaggedError>>
>;
export type SubscriptionProcedureClientLike = ProcedureClientConstraint<
  AnyProcedureClientTypes & {
    readonly kind: "subscription";
    readonly capability: ClientUnaryTypes;
  },
  unknown
>;

export type SubscriptionClientInput<TProcedureClient> = ClientProcedureInput<TProcedureClient>;
export type SubscriptionClientOutput<TProcedureClient> = ClientProcedureOutput<TProcedureClient>;
export type SubscriptionClientError<TProcedureClient> = ClientProcedureError<TProcedureClient>;

export type ProcedureClientInput<TProcedureClient> = ClientProcedureInput<TProcedureClient>;
export type ProcedureClientResult<TProcedureClient> = Result<
  ClientProcedureOutput<TProcedureClient>,
  ClientProcedureError<TProcedureClient>
>;
export type ProcedureClientOutput<TProcedureClient> = ClientProcedureOutput<TProcedureClient>;
export type ProcedureClientError<TProcedureClient> = ClientProcedureError<TProcedureClient>;

export type IsUnion<TValue, TWhole = TValue> = TValue extends TWhole
  ? [TWhole] extends [TValue]
    ? false
    : true
  : never;

/**
 * Procedure and input are one associated fact. A value that still represents
 * several procedures must be narrowed before entering an operation API;
 * otherwise TypeScript independently unions their inputs and admits an
 * impossible pair.
 */
export type NarrowProcedureClient<TProcedureClient> =
  true extends IsUnion<TProcedureClient>
    ? TProcedureClient & RpcConstraintError<"procedure-union-must-be-narrowed", TProcedureClient>
    : TProcedureClient;

/** A client function minted for a `.paginate()` procedure. */
export type PaginatedProcedureClientLike = ProcedureClientConstraint<
  AnyProcedureClientTypes & {
    readonly input: PageRequest<unknown, unknown>;
    readonly output: Page<unknown, unknown>;
    readonly kind: "query";
    readonly capability: ClientPaginationTypes<unknown, unknown, unknown>;
  },
  Promise<Result<unknown, AnyTaggedError>>
>;

type QueryKeyProcedureClientLike = QueryProcedureClientLike | PaginatedProcedureClientLike;

/**
 * Audited callable boundary for associated-type existentials. The generic API
 * has already correlated `input` with this exact client's carrier; `never`
 * prevents callers that only hold an erased constraint from inventing one.
 */
const invokeProcedureClient = <TProcedureClient extends ProcedureClientLike>(
  procedure: TProcedureClient,
  input: ClientProcedureInput<TProcedureClient>,
  options: RuntimeCallOptions,
): Promise<ProcedureClientResult<TProcedureClient>> =>
  procedure(input as never, options) as Promise<ProcedureClientResult<TProcedureClient>>;

const invokePaginatedClient = <TProcedureClient extends PaginatedProcedureClientLike>(
  procedure: TProcedureClient,
  list: PaginatedClientListInput<TProcedureClient>,
  cursor: PaginatedClientCursor<TProcedureClient> | null,
  options: RuntimeCallOptions,
): Promise<
  Result<
    Page<PaginatedClientItem<TProcedureClient>, PaginatedClientCursor<TProcedureClient>>,
    ProcedureClientError<TProcedureClient>
  >
> =>
  procedure({ list, cursor } as never, options) as Promise<
    Result<
      Page<PaginatedClientItem<TProcedureClient>, PaginatedClientCursor<TProcedureClient>>,
      ProcedureClientError<TProcedureClient>
    >
  >;

const decodePaginatedPage = <TProcedureClient extends PaginatedProcedureClientLike>(
  procedure: ClientProcedureSource<TProcedureClient>,
  value: unknown,
) =>
  // Source capability and output codec are one associated record; successful
  // decode proves the page specialization lost at the erased metadata edge.
  procedure._def.output.decode(value) as import("../wire.js").DecodeResult<
    Page<PaginatedClientItem<TProcedureClient>, PaginatedClientCursor<TProcedureClient>>
  >;

const normalizePaginatedCursor = <TProcedureClient extends PaginatedProcedureClientLike>(
  procedure: ClientProcedureSource<TProcedureClient>,
  pagination: PaginationManifest,
  value: unknown,
): import("../wire.js").DecodeResult<PaginatedClientCursor<TProcedureClient> | null> => {
  if (value === null) return { ok: true, value: null };
  const encoded = encodeProcedureInput(pagination.cursor, value);
  if (!encoded.ok) return encoded;
  // The pagination manifest and source procedure come from the same
  // capability record; runtime encode/decode validates the erased cursor.
  return pagination.cursor.decode(encoded.value) as import("../wire.js").DecodeResult<
    PaginatedClientCursor<TProcedureClient>
  >;
};

const invokeSubscriptionClient = <TProcedureClient extends SubscriptionProcedureClientLike>(
  procedure: TProcedureClient,
  input: SubscriptionClientInput<TProcedureClient>,
  lastEventId?: string,
): ResultSubscription<
  SubscriptionClientOutput<TProcedureClient>,
  SubscriptionClientError<TProcedureClient>
> =>
  procedure(
    input as never,
    lastEventId === undefined ? undefined : ({ lastEventId } as never),
  ) as ResultSubscription<
    SubscriptionClientOutput<TProcedureClient>,
    SubscriptionClientError<TProcedureClient>
  >;

export type PaginatedClientListInput<TProcedureClient> =
  ClientProcedureInput<TProcedureClient> extends PageRequest<infer TListInput, infer _TCursor>
    ? TListInput
    : never;
export type PaginatedClientCursor<TProcedureClient> =
  ClientProcedureInput<TProcedureClient> extends PageRequest<infer _TListInput, infer TCursor>
    ? TCursor
    : never;
export type PaginatedClientItem<TProcedureClient> =
  ClientProcedureOutput<TProcedureClient> extends Page<infer TItem, infer _TCursor> ? TItem : never;

export type FetchState = "idle" | "fetching" | "paused";

export interface QueryControls {
  readonly fetch: FetchState;
  readonly failureCount: number;
  readonly isStale: boolean;
  readonly updatedAt: number;
  /** Starts a fresh fetch. Observe the returned state through this observer/hook. */
  readonly refetch: () => Promise<void>;
}

export type QueryState<T, E extends AnyTaggedError> =
  | (QueryControls &
      Readonly<{
        state: "pending";
        value?: undefined;
        error?: undefined;
      }>)
  | (QueryControls &
      Readonly<{
        state: "success";
        value: T;
        error?: undefined;
      }>)
  | (QueryControls &
      Readonly<{
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
export type PaginatedState<TItem, E extends AnyTaggedError> =
  | (PaginatedControls &
      Readonly<{
        state: "pending";
        rows?: undefined;
        error?: undefined;
      }>)
  | (PaginatedControls &
      Readonly<{
        state: "success";
        rows: readonly TItem[];
        error?: undefined;
      }>)
  | (PaginatedControls &
      Readonly<{
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
  readonly mutate: (input: TInput) => Promise<Result<TOutput, TError>>;
  readonly cancel: () => void;
  readonly reset: () => void;
}

export type MutationState<TInput, TOutput, TError extends AnyTaggedError> =
  | (MutationControls<TInput, TOutput, TError> &
      Readonly<{
        state: "idle";
        value?: undefined;
        error?: undefined;
      }>)
  | (MutationControls<TInput, TOutput, TError> &
      Readonly<{
        state: "pending";
        value?: undefined;
        error?: undefined;
        variables: TInput;
      }>)
  | (MutationControls<TInput, TOutput, TError> &
      Readonly<{
        state: "success";
        value: TOutput;
        error?: undefined;
        variables: TInput;
      }>)
  | (MutationControls<TInput, TOutput, TError> &
      Readonly<{
        state: "failure";
        error: TError;
        value?: undefined;
        variables: TInput;
      }>);

export interface MutationOptions<
  in TInput,
  in TOutput,
  in TError extends AnyTaggedError,
  in out TContext = undefined,
> {
  readonly retry?: false | number | ((error: TError, failureCount: number) => boolean) | undefined;
  readonly optimistic?: (
    input: TInput,
    cache: QueryCache,
  ) => TContext | undefined | Promise<TContext | undefined>;
  readonly onSuccess?: (value: TOutput, input: TInput) => void | Promise<void>;
  readonly onFailure?: (
    error: TError,
    input: TInput,
    context: TContext | undefined,
    cache: QueryCache,
  ) => void | Promise<void>;
  /**
   * Cleans up local optimistic work when control flow interrupts the consumer:
   * an explicit cancellation, a mounted React shell claiming the failure, or
   * a shell definition-identity mismatch failing loudly before typed failure
   * callbacks. The rejected mutation promise distinguishes `cancelled` from
   * `claimed`; a definition mismatch rejects with its diagnostic `TypeError`.
   */
  readonly onCancel?: (
    input: TInput,
    context: TContext | undefined,
    cache: QueryCache,
  ) => void | Promise<void>;
  readonly onSettled?: (
    result: Result<TOutput, TError>,
    input: TInput,
    context: TContext | undefined,
    cache: QueryCache,
  ) => void | Promise<void>;
}

export interface QueryCache {
  key<const TProcedureClient extends QueryProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    input: ProcedureClientInput<NoInfer<TProcedureClient>>,
  ): ResultQueryKey;
  get<const TProcedureClient extends QueryProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    input: ProcedureClientInput<NoInfer<TProcedureClient>>,
  ): ProcedureClientOutput<TProcedureClient> | undefined;
  update<const TProcedureClient extends QueryProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    input: ProcedureClientInput<NoInfer<TProcedureClient>>,
    updater: (
      current: ProcedureClientOutput<TProcedureClient> | undefined,
    ) => ProcedureClientOutput<TProcedureClient> | undefined,
  ): () => void;
  invalidate<const TProcedureClient extends QueryProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    input: ProcedureClientInput<NoInfer<TProcedureClient>>,
  ): Promise<void>;
  invalidateAll<const TProcedureClient extends QueryProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
  ): Promise<void>;
  /** Invalidates every cached query whose result contains the entity. */
  invalidateEntity<TModel extends AnyModel>(
    model: TModel,
    id: ModelKeyInput<TModel>,
  ): Promise<void>;
  /**
   * Patches the entity in place everywhere it appears — one call updates the
   * detail view, every list row, the header. The updater receives the cached
   * value as an identity-bearing projection: non-key model fields are optional.
   * Its partial result is merged by the projection rule. Returns a rollback,
   * composing with `optimistic:` exactly like `update`.
   */
  updateEntity<TModel extends AnyModel>(
    model: TModel,
    id: ModelKeyInput<TModel>,
    updater: (current: ModelProjection<TModel>) => Partial<ModelValue<TModel>>,
  ): () => void;
}

export interface ResultMutationObserver<TInput, TOutput, TError extends AnyTaggedError> {
  readonly getCurrentState: () => MutationState<TInput, TOutput, TError>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly mutate: (input: TInput) => Promise<Result<TOutput, TError>>;
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
export type QueryStateOf<TProcedureClient extends QueryProcedureClientLike> = QueryState<
  ProcedureClientOutput<TProcedureClient>,
  ProcedureClientError<TProcedureClient>
>;

/** Paginated state derived directly from a concrete paginated client procedure. */
export type PaginatedStateOf<TProcedureClient extends PaginatedProcedureClientLike> =
  PaginatedState<PaginatedClientItem<TProcedureClient>, ProcedureClientError<TProcedureClient>>;

/** Mutation state derived directly from a concrete mutation client procedure. */
export type MutationStateOf<TProcedureClient extends MutationProcedureClientLike> = MutationState<
  ProcedureClientInput<TProcedureClient>,
  ProcedureClientOutput<TProcedureClient>,
  ProcedureClientError<TProcedureClient>
>;

/** Subscription state derived directly from a concrete subscription client procedure. */
export type SubscriptionStateOf<TProcedureClient extends SubscriptionProcedureClientLike> =
  SubscriptionState<
    SubscriptionClientOutput<TProcedureClient>,
    SubscriptionClientError<TProcedureClient>
  >;

export interface ResultSubscriptionObserver<out T, out E extends AnyTaggedError> {
  readonly getCurrentState: () => SubscriptionState<T, E>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly reconnect: () => void;
  readonly close: () => void;
}

/**
 * Whether a query's failure belongs in a hydration payload.
 *
 * Declared domain errors do: `theme/not-found` is the answer to the query, and
 * this library's first claim is that such errors are values. Framework and
 * transport failures do not — `client/network-failure` describes one attempt on
 * one machine, and shipping it as settled truth would replace a fetch the
 * client can retry with a verdict it cannot.
 */
/** The wire shape a dehydrated failure arrives as: `{ _tag, data }`. */
const isEncodedTaggedError = (value: unknown): value is { readonly _tag: string } =>
  typeof value === "object" && value !== null && "_tag" in value && "data" in value;

const isDehydratableFailure = (failure: unknown): boolean =>
  isTaggedError(failure) &&
  !Object.values(frameworkErrorDefinitions).some((definition) => definition.tag === failure._tag);

const defaultShouldRetry = (
  definitions: ErrorDefinitionMap,
  failureCount: number,
  failure: unknown,
): boolean => {
  if (!isTaggedError(failure)) return false;
  // Retrying an offline failure while the browser still reports offline is
  // needless churn — the recovery path is the reconnect resume, not a timer.
  if (failure._tag === "client/offline" && !getOnlineSnapshot()) return false;
  const retry = definitionFor(definitions, failure)?.policy.retry;
  return (retry === "transient" || retry === "after") && failureCount < 3;
};

/**
 * Mutations get a stricter default: a mutation whose connection died
 * MID-FLIGHT is ambiguous — the server may have processed it, and a blind
 * retry is the double-side-effect bug. Only two failures are safe by
 * default:
 * - `client/offline`: the transport short-circuits BEFORE sending, so the
 *   request provably never left the client;
 * - policy `retry: "after"`: the server responded and explicitly scheduled
 *   the retry, so it chose not to process the attempt.
 * Everything else (network-failure, timeout, 5xx) surfaces immediately.
 * Callers with idempotent mutations can opt back in via `retry:`;
 * idempotency keys are the roadmap for making full retry the default.
 */
const defaultRetryDelay = (
  definitions: ErrorDefinitionMap,
  failureCount: number,
  failure: unknown,
): number => {
  if (isTaggedError(failure) && definitionFor(definitions, failure)?.policy.retry === "after") {
    const data = failure.data;
    if (
      data !== null &&
      typeof data === "object" &&
      "retryAfterMs" in data &&
      typeof data.retryAfterMs === "number"
    )
      return Math.max(0, data.retryAfterMs);
  }
  return Math.min(250 * 2 ** failureCount, 2_000);
};

const project = <T, E extends AnyTaggedError>(
  observed: QueryObserverResult<T, E>,
  refetch: () => Promise<void>,
): QueryState<T, E> => {
  const controls: QueryControls = {
    fetch: observed.fetchStatus,
    failureCount: observed.failureCount,
    isStale: observed.isStale,
    updatedAt: observed.dataUpdatedAt,
    refetch,
  };
  if (observed.status === "pending") {
    return { ...controls, state: "pending" };
  }
  if (observed.status === "success") {
    return { ...controls, state: "success", value: observed.data };
  }
  if (!isTaggedError(observed.error)) {
    throw new TypeError("Query engine received an untagged failure");
  }
  return {
    ...controls,
    state: "failure",
    error: observed.error,
    ...(observed.data === undefined ? {} : { previous: observed.data }),
  };
};

/**
 * Flattens `InfiniteData<Page>` into one row list, deduplicating by entity
 * identity. Duplicates are cursor drift — an insert/delete slid a row across
 * a page boundary between fetches. First occurrence wins positionally;
 * field freshness is identity-driven (patches reach the retained row), so
 * dropping the later copy loses nothing.
 */
const flattenPages = <TItem, TCursor>(
  data: { readonly pages: readonly Page<TItem, TCursor>[] } | undefined,
): readonly TItem[] | undefined => {
  if (data === undefined) return undefined;
  const rows: TItem[] = [];
  const seen = new Set<EntityCacheKey>();
  for (const page of data.pages) {
    for (const item of page.items) {
      if (item !== null && typeof item === "object") {
        const model = entityBrandOf(item);
        if (model) {
          const id = entityIdOf(item, model);
          if (id !== undefined) {
            const key = entityKey(model.name, id);
            if (seen.has(key)) continue;
            seen.add(key);
          }
        }
      }
      rows.push(item);
    }
  }
  return rows;
};

type NormalizedInfiniteData<TPage> = {
  readonly pages: TPage[];
  readonly pageParams: unknown[];
};

const normalizeInfiniteData = <TPage>(
  value: unknown,
  decodePage: (
    value: unknown,
  ) => { readonly ok: true; readonly value: TPage } | { readonly ok: false },
): NormalizedInfiniteData<TPage> | undefined => {
  if (value === null || typeof value !== "object" || !("pages" in value)) return undefined;
  if (!Array.isArray(value.pages)) return undefined;
  const pages: TPage[] = [];
  for (const page of value.pages) {
    const decoded = decodePage(page);
    if (!decoded.ok) return undefined;
    pages.push(decoded.value);
  }
  const pageParams =
    "pageParams" in value && Array.isArray(value.pageParams) ? [...value.pageParams] : [];
  return { pages, pageParams };
};

/**
 * Re-wraps a settled query or mutation state as the same `Result` the
 * imperative client returns — for handing a hook outcome to Result-typed
 * code. `undefined` while the state is still pending or idle.
 */
export function toResult<T, E extends AnyTaggedError>(
  state: QueryState<T, E>,
): Result<T, E> | undefined;
export function toResult<TInput, TOutput, TError extends AnyTaggedError>(
  state: MutationState<TInput, TOutput, TError>,
): Result<TOutput, TError> | undefined;
export function toResult(
  state: Readonly<{ state: string; value?: unknown; error?: AnyTaggedError | undefined }>,
): Result<unknown, AnyTaggedError> | undefined {
  if (state.state === "success") return ok(state.value);
  if (state.state === "failure" && state.error !== undefined) return err(state.error);
  return undefined;
}

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
  observe<const TProcedureClient extends QueryProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    input: ProcedureClientInput<NoInfer<TProcedureClient>>,
    options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>,
  ): ResultQueryObserver<
    ProcedureClientOutput<TProcedureClient>,
    ProcedureClientError<TProcedureClient>
  >;
  prefetch<const TProcedureClient extends QueryProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    input: ProcedureClientInput<NoInfer<TProcedureClient>>,
    options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>,
  ): Promise<ProcedureClientResult<TProcedureClient>>;
  observePaginated<const TProcedureClient extends PaginatedProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    input: PaginatedClientListInput<NoInfer<TProcedureClient>>,
    options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>,
  ): ResultPaginatedObserver<
    PaginatedClientItem<TProcedureClient>,
    ProcedureClientError<TProcedureClient>
  >;
  /** Warms the first page; loaders and SSR use this. */
  prefetchPaginated<const TProcedureClient extends PaginatedProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    input: PaginatedClientListInput<NoInfer<TProcedureClient>>,
    options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>,
  ): Promise<
    Result<readonly PaginatedClientItem<TProcedureClient>[], ProcedureClientError<TProcedureClient>>
  >;
  mutation<const TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    options?: MutationOptions<
      ProcedureClientInput<TProcedureClient>,
      ProcedureClientOutput<TProcedureClient>,
      ProcedureClientError<TProcedureClient>,
      TContext
    >,
  ): ResultMutationObserver<
    ProcedureClientInput<TProcedureClient>,
    ProcedureClientOutput<TProcedureClient>,
    ProcedureClientError<TProcedureClient>
  >;
  subscription<const TProcedureClient extends SubscriptionProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    input: SubscriptionClientInput<NoInfer<TProcedureClient>>,
    options?: SubscriptionOptions<SubscriptionClientError<NoInfer<TProcedureClient>>>,
  ): ResultSubscriptionObserver<
    SubscriptionClientOutput<TProcedureClient>,
    SubscriptionClientError<TProcedureClient>
  >;
  dehydrate(): DehydratedQueryRuntime;
  hydrate(state: DehydratedQueryRuntime): void;
  clear(): void;
}

export const createQueryRuntime = <TClient>(
  options: CreateQueryRuntimeOptions<TClient>,
): QueryRuntime<TClient> => {
  if (
    (typeof options.client !== "object" && typeof options.client !== "function") ||
    options.client === null
  )
    throw new TypeError("Expected a result-rpc client");
  const clientIdentity = getClientIdentity(options.client);
  if (!clientIdentity) throw new TypeError("Expected a result-rpc client");
  const contractVersion = getClientContractVersion(clientIdentity);
  if (!contractVersion) throw new TypeError("Result-rpc client has no registered contract version");
  // Mounted so query-core's online manager continues paused retries and
  // resumes paused mutations on reconnect. Stale refetching on focus and
  // reconnect stays off: browser events time failure *resumes* here — cache
  // freshness policy is a separate concern and a separate knob.
  //
  // Reads pause while offline (networkMode "online" default): no thrash, no
  // retry-budget burn, the engine continues them on reconnect. Writes stay
  // loud (networkMode "always"): a mutation attempted offline fails with
  // `client/offline` for its owner to decide — the framework never queues a
  // side effect for silent later delivery.
  wireOnlineManager();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // Brand-preserving structural sharing: the default replaceEqualDeep
        // manufactures identity-fresh copies on every merge, and entity
        // brands live on object identity — without this, the first patch
        // (or any refetch, or hydration) silently evicts entities from the
        // index. See shareStructural in model.ts.
        structuralSharing: (oldData: unknown, newData: unknown) =>
          shareStructural(oldData, newData),
      },
      mutations: { networkMode: "always" },
    },
  });
  queryClient.mount();

  const metadataFor = <TProcedureClient extends Function & ProcedureClientTypeCarrier>(
    procedure: TProcedureClient,
  ) => {
    const metadata = getProcedureClientMetadata(procedure);
    if (!metadata || metadata.clientIdentity !== clientIdentity) {
      throw new TypeError("Procedure client belongs to a different result-rpc client");
    }
    return metadata;
  };

  const paginationOf = (metadata: ReturnType<typeof metadataFor>): PaginationManifest | undefined =>
    metadata.procedure._def.pagination;

  const queryKey = (procedure: QueryKeyProcedureClientLike, input: unknown): ResultQueryKey => {
    const metadata = metadataFor(procedure);
    if (metadata.procedure._def.kind !== "query") {
      throw new TypeError(`${metadata.path} is not a query procedure`);
    }
    // Paginated queries key on the LIST identity alone — every page of one
    // list shares one cache entry, so `input` here means the list input and
    // the cursor never fragments the key. Invalidation and `.affects()`
    // targeting therefore reach all pages with the list-shaped input the
    // caller already has.
    if (paginationOf(metadata)) {
      const encoded = encodeProcedureInput(metadata.procedure._def.input, {
        list: input,
        cursor: null,
      });
      if (!encoded.ok) throw new TypeError(`Invalid query input for ${metadata.path}`);
      if (
        encoded.value === null ||
        typeof encoded.value !== "object" ||
        !("list" in encoded.value)
      ) {
        throw new TypeError(`Invalid paginated input shape for ${metadata.path}`);
      }
      const listPart = encoded.value.list;
      const serialized = serialize(listPart, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
      if (!serialized.ok)
        throw new TypeError(`Query input for ${metadata.path} is not serializable`);
      return [metadata.path, serialized.value] as const;
    }
    const encoded = encodeProcedureInput(metadata.procedure._def.input, input);
    if (!encoded.ok) throw new TypeError(`Invalid query input for ${metadata.path}`);
    const serialized = serialize(encoded.value, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
    if (!serialized.ok) throw new TypeError(`Query input for ${metadata.path} is not serializable`);
    return [metadata.path, serialized.value] as const;
  };

  // --- Entity index: entityKey ↔ cached queries containing it ---------------
  // Maintained from query-cache events; every success value is walked for
  // branded entity objects (the decode pass branded them).
  const entityToQueries = new Map<EntityCacheKey, Set<string>>();
  const queryToEntities = new Map<string, Set<EntityCacheKey>>();
  const queryKeyByHash = new Map<string, readonly unknown[]>();

  const dropQueryFromIndex = (hash: string) => {
    const previous = queryToEntities.get(hash);
    if (previous) {
      for (const key of previous) {
        const hashes = entityToQueries.get(key);
        hashes?.delete(hash);
        if (hashes && hashes.size === 0) entityToQueries.delete(key);
      }
    }
    queryToEntities.delete(hash);
    queryKeyByHash.delete(hash);
  };

  const reindexQuery = (query: {
    readonly queryHash: string;
    readonly queryKey: readonly unknown[];
    readonly state: { readonly status: string; readonly data: unknown };
  }) => {
    dropQueryFromIndex(query.queryHash);
    if (query.state.status !== "success" || query.state.data === undefined) return;
    const keys = new Set<EntityCacheKey>();
    for (const entity of collectEntities(query.state.data)) {
      keys.add(entityKey(entity.model.name, entity.id));
    }
    if (keys.size === 0) return;
    queryToEntities.set(query.queryHash, keys);
    queryKeyByHash.set(query.queryHash, query.queryKey);
    for (const key of keys) {
      const hashes = entityToQueries.get(key) ?? new Set<string>();
      hashes.add(query.queryHash);
      entityToQueries.set(key, hashes);
    }
  };

  // Patch-driven writes cannot change entity MEMBERSHIP (a merge only
  // rewrites field values of entities already present), so reindexing after
  // them is pure waste — and at scale (one hot entity in hundreds of cached
  // queries) it was the dominant cost of a patch.
  let suppressReindex = 0;

  /**
   * Queries holding a confirmed entity write that no authoritative fetch has
   * reconciled yet. `dataUpdatedAt` cannot carry this: a patch deliberately
   * leaves it alone so staleness is not laundered, which also means a patched
   * query looks older than it is to anything comparing timestamps — hydration
   * above all.
   */
  const unreconciledLocalWrites = new Set<string>();

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "added") reindexQuery(event.query);
    else if (event.type === "updated") {
      if (suppressReindex > 0) return;
      // Only data-bearing updates can change entity membership; fetchStatus
      // flips, invalidation marks, and errors would re-walk unchanged data.
      const action = "action" in event ? event.action : undefined;
      if (action?.type === "success") {
        // Authoritative data replaced the local write, so the ledger entry has
        // served its purpose. Patches never reach here — they raise
        // `suppressReindex` above — so this only sees real results.
        unreconciledLocalWrites.delete(event.query.queryHash);
        reindexQuery(event.query);
      }
    } else if (event.type === "removed") dropQueryFromIndex(event.query.queryHash);
  });

  const queriesContaining = (model: AnyModel, id: EntityId): readonly string[] => [
    ...(entityToQueries.get(entityKey(model.name, id)) ?? []),
  ];

  /**
   * Write-through: replace the entity wherever it appears, by the projection
   * rule. Falls back to nothing when the merge changes nothing — a patch that
   * cannot apply is simply not a patch.
   */
  const patchOneQuery = (
    queryKey: readonly unknown[],
    model: AnyModel,
    id: EntityId,
    produce: (current: Record<string, unknown>) => Record<string, unknown>,
  ): boolean => {
    const previous = queryClient.getQueryData(queryKey);
    if (previous === undefined) return false;
    const { value, changed } = patchEntity(previous, model, id, produce);
    if (!changed) return false;
    // A patch must not launder staleness: setQueryData normally counts as a
    // fresh fetch (clearing isInvalidated and bumping dataUpdatedAt), but a
    // patch is entity-partial — it cannot satisfy a pending invalidation
    // (membership changes, other entities) and it must not reset the
    // staleTime clock. Preserve both.
    const query = queryClient.getQueryCache().find({ queryKey, exact: true });
    const updatedAt = query?.state.dataUpdatedAt;
    const wasInvalidated = query?.state.isInvalidated ?? false;
    suppressReindex += 1;
    try {
      queryClient.setQueryData(
        queryKey,
        value,
        updatedAt === undefined ? undefined : { updatedAt },
      );
    } finally {
      suppressReindex -= 1;
    }
    if (query) unreconciledLocalWrites.add(query.queryHash);
    if (wasInvalidated) query?.invalidate();
    return true;
  };

  const patchQueriesWith = (
    model: AnyModel,
    id: EntityId,
    produce: (current: Record<string, unknown>) => Record<string, unknown>,
  ): ReadonlyArray<() => void> => {
    const restores: Array<() => void> = [];
    for (const hash of queriesContaining(model, id)) {
      const queryKey = queryKeyByHash.get(hash);
      if (!queryKey) continue;
      const previous = queryClient.getQueryData(queryKey);
      if (previous === undefined) continue;
      // Rollback is ENTITY-scoped, not a whole-query snapshot: restoring a
      // snapshot would erase every later independent write to other entities
      // in the same query. Capture this entity's projection-shaped value and
      // roll back by re-patching it.
      const captured = collectEntities(previous).find(
        (entity) => entity.model === model && entity.id === id,
      )?.value;
      const query = queryClient.getQueryCache().get(hash);
      const wasFetching = query?.state.fetchStatus === "fetching";
      const applied = patchOneQuery(queryKey, model, id, produce);
      if (wasFetching) {
        // A response already in flight predates this patch and may carry
        // older entity state; letting it land would regress the screen.
        // Cancel it (query-core reverts to the pre-fetch snapshot, async),
        // re-apply the patch on top of whatever the revert restored, then
        // invalidate: the cancelled response may have carried data the patch
        // does not cover (membership, other entities), and a fresh fetch —
        // started after the mutation — converges on all of it.
        void queryClient.cancelQueries({ queryKey, exact: true }).then(() => {
          patchOneQuery(queryKey, model, id, produce);
          return queryClient.invalidateQueries({ queryKey, exact: true });
        });
      }
      if (!applied || !captured) continue;
      restores.push(() => {
        patchOneQuery(queryKey, model, id, (current) => mergeByExistingKeys(current, captured));
      });
    }
    return restores;
  };

  /** Invalidate every query containing any of the entity keys (`model:id`). */
  const invalidateEntityKeys = (keys: readonly EntityCacheKey[]): Promise<void> =>
    Promise.all(
      keys.flatMap((key) =>
        [...(entityToQueries.get(key) ?? [])].map((hash) => {
          const queryKey = queryKeyByHash.get(hash);
          return queryKey
            ? queryClient.invalidateQueries({ queryKey, exact: true })
            : Promise.resolve();
        }),
      ),
    ).then(() => undefined);

  /**
   * Per-entity write ordering. Responses carry no versions, so arrival order
   * is the only order the network gives us — and a slow response from an
   * older write must not patch stale fields over a newer confirmed write
   * (two optimistic mutations on one entity is the classic shape). Each
   * authoritative write records a start-ordered sequence per entity; a
   * response arriving out of order does NOT patch backwards — it invalidates
   * the entity instead, and the refetch converges on the server.
   */
  let writeSeq = 0;
  const nextWriteSeq = () => ++writeSeq;
  const entityWriteSeq = new Map<EntityCacheKey, number>();

  /** Mutation output entities drive write-through patches by identity. */
  const applyEntityWrites = (output: unknown, seq?: number): void => {
    for (const entity of collectEntities(output)) {
      const key = entityKey(entity.model.name, entity.id);
      if (seq !== undefined) {
        const last = entityWriteSeq.get(key);
        if (last !== undefined && last > seq) {
          void invalidateEntityKeys([key]);
          continue;
        }
        entityWriteSeq.set(key, seq);
      }
      patchQueriesWith(entity.model, entity.id, (current) =>
        mergeByExistingKeys(current, entity.value),
      );
    }
  };

  /**
   * Resolves an `.affects()` target — a contract entry or procedure object —
   * to this client's procedure function, by identity against the router the
   * client was built from (implemented procedures share their contract's
   * codec references, so contract-declared targets resolve on router clients
   * too).
   */
  const resolveAffectsTarget = (
    target: AffectsEntry["target"],
  ): QueryProcedureClientLike | undefined => {
    const router = getClientRouter(clientIdentity);
    if (!router) return undefined;
    for (const [path, procedure] of router.procedures) {
      const matches =
        Object.is(procedure, target) ||
        procedure._def === target._def ||
        (procedure._def.kind === "query" &&
          procedure._def.input === target._def.input &&
          procedure._def.output === target._def.output);
      if (!matches) continue;
      let node: unknown = options.client;
      for (const segment of path.split(".")) {
        if (node === null || (typeof node !== "object" && typeof node !== "function")) {
          return undefined;
        }
        node = Reflect.get(node, segment);
      }
      if (typeof node !== "function") return undefined;
      const resolvedMetadata = getProcedureClientMetadata(node);
      if (
        !resolvedMetadata ||
        resolvedMetadata.clientIdentity !== clientIdentity ||
        resolvedMetadata.path !== path ||
        resolvedMetadata.procedure._def.kind !== "query"
      ) {
        return undefined;
      }
      // The registered metadata proves the dynamically traversed function is
      // this client's query callable; only its associated carrier was erased.
      return node as QueryProcedureClientLike;
    }
    return undefined;
  };

  const cache: QueryCache = {
    key: queryKey,
    get: (procedure, input) => queryClient.getQueryData(queryKey(procedure, input)),
    update: (procedure, input, updater) => {
      const key = queryKey(procedure, input);
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, updater);
      return () => queryClient.setQueryData(key, previous);
    },
    invalidate: async (procedure, input) => {
      await queryClient.invalidateQueries({
        queryKey: queryKey(procedure, input),
        exact: true,
      });
    },
    invalidateAll: async (procedure) => {
      const metadata = metadataFor(procedure);
      await queryClient.invalidateQueries({ queryKey: [metadata.path] });
    },
    invalidateEntity: (model, id) => {
      const resolved = entityIdFor(model, id);
      if (resolved === undefined) {
        throw new TypeError(`Entity key for ${model.name} is missing key fields`);
      }
      return invalidateEntityKeys([entityKey(model.name, resolved)]);
    },
    updateEntity: (model, id, updater) => {
      const resolved = entityIdFor(model, id);
      if (resolved === undefined) {
        throw new TypeError(`Entity key for ${model.name} is missing key fields`);
      }
      const restores = patchQueriesWith(model, resolved, (current) => {
        // patchQueriesWith selected this branded model/id, which is the
        // runtime proof for the projection-shaped input.
        const fresh = updater(current as ModelProjection<typeof model>);
        if (!isEntityRecord(fresh)) {
          throw new TypeError(`Entity updater for ${model.name} must return an object`);
        }
        return mergeByExistingKeys(current, fresh);
      });
      return () => {
        for (const restore of restores) restore();
      };
    },
  };

  const runtime: QueryRuntime<TClient> = {
    client: options.client,
    cache,
    observe: <TProcedureClient extends QueryProcedureClientLike>(
      procedure: TProcedureClient,
      input: ProcedureClientInput<TProcedureClient>,
      queryOptions: QueryOptions<ProcedureClientError<TProcedureClient>> = {},
    ) => {
      const metadata = metadataFor(procedure);
      if (metadata.procedure._def.kind !== "query") {
        throw new TypeError(`${metadata.path} is not a query procedure`);
      }
      if (paginationOf(metadata)) {
        throw new TypeError(
          `${metadata.path} is paginated; observe it with observePaginated (useResultPaginatedQuery)`,
        );
      }

      const encodedInput = encodeProcedureInput(metadata.procedure._def.input, input);
      if (!encodedInput.ok) throw new TypeError(`Invalid query input for ${metadata.path}`);

      const definitions: ErrorDefinitionMap = metadata.procedure._def.definitions;
      const key = queryKey(procedure, input);
      const hydratedState = queryClient.getQueryState(key);
      if (hydratedState?.status === "success") {
        const decoded = metadata.procedure._def.output.decode(hydratedState.data);
        if (!decoded.ok) {
          queryClient.removeQueries({ queryKey: key, exact: true });
        } else {
          // Normalize/copy rich values through the declared output codec
          // before trust — WITHOUT laundering staleness: preserve both the
          // freshness clock and any pending invalidation, or a remount would
          // trust stale data as fresh and skip its refetch.
          queryClient.setQueryData(key, decoded.value, {
            updatedAt: hydratedState.dataUpdatedAt,
          });
          if (hydratedState.isInvalidated) {
            queryClient.getQueryCache().find({ queryKey: key, exact: true })?.invalidate();
          }
        }
      }
      // Read retry lazily on every attempt — see the mutation counterpart.
      const retry = (failureCount: number, failure: unknown) => {
        const configured = queryOptions.retry;
        if (configured === undefined) {
          return defaultShouldRetry(definitions, failureCount, failure);
        }
        if (typeof configured === "function") {
          return metadata.errors.is(failure) && configured(failure, failureCount);
        }
        return configured !== false && failureCount < configured;
      };
      const observerOptions = {
        queryKey: key,
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          try {
            const result = await invokeProcedureClient(procedure, input, { signal });
            if (!result.ok) throw result.error;
            return result.value;
          } catch (failure) {
            if (isCancelled(failure)) throw new CancelledError({ revert: true });
            throw failure;
          }
        },
        ...(queryOptions.enabled === undefined ? {} : { enabled: queryOptions.enabled }),
        ...(queryOptions.staleTime === undefined ? {} : { staleTime: queryOptions.staleTime }),
        ...(queryOptions.gcTime === undefined ? {} : { gcTime: queryOptions.gcTime }),
        retry,
        retryDelay: (failureCount: number, failure: unknown) =>
          defaultRetryDelay(definitions, failureCount, failure),
      };

      const observer = new QueryObserver<
        ProcedureClientOutput<TProcedureClient>,
        ProcedureClientError<TProcedureClient>
      >(queryClient, observerOptions);

      let cached: QueryState<
        ProcedureClientOutput<TProcedureClient>,
        ProcedureClientError<TProcedureClient>
      >;

      const refetchState = async (): Promise<
        QueryState<ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>>
      > => {
        const observed = await observer.refetch();
        cached = project(observed, refetch);
        return cached;
      };
      const refetch = async (): Promise<void> => {
        await refetchState();
      };
      cached = project(observer.getCurrentResult(), refetch);

      return {
        key,
        getCurrentState: () => cached,
        subscribe: (listener) =>
          observer.subscribe((observed) => {
            cached = project(observed, refetch);
            listener();
          }),
        refetch: refetchState,
        destroy: () => observer.destroy(),
      };
    },
    prefetch: async (procedure, input, prefetchOptions) => {
      const observer = runtime.observe(procedure, input, prefetchOptions);
      try {
        const state = await observer.refetch();
        if (state.state === "pending") {
          throw new TypeError("Prefetch did not settle");
        }
        return state.state === "success" ? ok(state.value) : err(state.error);
      } finally {
        observer.destroy();
      }
    },
    observePaginated: <TProcedureClient extends PaginatedProcedureClientLike>(
      procedure: TProcedureClient,
      input: PaginatedClientListInput<TProcedureClient>,
      queryOptions: QueryOptions<ProcedureClientError<TProcedureClient>> = {},
    ) => {
      type TItem = PaginatedClientItem<TProcedureClient>;
      type TCursor = PaginatedClientCursor<TProcedureClient>;
      type TError = ProcedureClientError<TProcedureClient>;
      type TPage = Page<TItem, TCursor>;

      const metadata = metadataFor(procedure);
      const pagination = paginationOf(metadata);
      if (metadata.procedure._def.kind !== "query" || !pagination) {
        throw new TypeError(`${metadata.path} is not a paginated query procedure`);
      }
      const definitions: ErrorDefinitionMap = metadata.procedure._def.definitions;
      const key = queryKey(procedure, input);

      // Hydrated pages are normalized through the page codec before trust —
      // per page, because the cached shape is InfiniteData, not one page.
      // Staleness is preserved exactly as for unary queries.
      const hydratedState = queryClient.getQueryState(key);
      if (hydratedState?.status === "success") {
        const normalized = normalizeInfiniteData<TPage>(hydratedState.data, (value) =>
          decodePaginatedPage<TProcedureClient>(metadata.procedure, value),
        );
        if (!normalized) {
          queryClient.removeQueries({ queryKey: key, exact: true });
        } else {
          queryClient.setQueryData(key, normalized, { updatedAt: hydratedState.dataUpdatedAt });
          if (hydratedState.isInvalidated) {
            queryClient.getQueryCache().find({ queryKey: key, exact: true })?.invalidate();
          }
        }
      }

      const retry = (failureCount: number, failure: unknown) => {
        const configured = queryOptions.retry;
        if (configured === undefined) {
          return defaultShouldRetry(definitions, failureCount, failure);
        }
        if (typeof configured === "function") {
          return metadata.errors.is(failure) && configured(failure, failureCount);
        }
        return configured !== false && failureCount < configured;
      };

      const observer = new InfiniteQueryObserver<
        TPage,
        TError,
        InfiniteData<TPage>,
        ResultQueryKey,
        TCursor | null
      >(queryClient, {
        queryKey: key,
        queryFn: async ({ signal, pageParam }) => {
          try {
            const cursor = normalizePaginatedCursor<TProcedureClient>(
              metadata.procedure,
              pagination,
              pageParam,
            );
            if (!cursor.ok) throw new TypeError(`Invalid pagination cursor for ${metadata.path}`);
            const result = await invokePaginatedClient(procedure, input, cursor.value, { signal });
            if (!result.ok) throw result.error;
            return result.value;
          } catch (failure) {
            if (isCancelled(failure)) throw new CancelledError({ revert: true });
            throw failure;
          }
        },
        initialPageParam: null,
        // `nextCursor: null` means exhausted — query-core reads null as
        // "no next page", so hasNext falls out of the declared shape.
        getNextPageParam: (lastPage: TPage) => lastPage.nextCursor,
        ...(queryOptions.enabled === undefined ? {} : { enabled: queryOptions.enabled }),
        ...(queryOptions.staleTime === undefined ? {} : { staleTime: queryOptions.staleTime }),
        ...(queryOptions.gcTime === undefined ? {} : { gcTime: queryOptions.gcTime }),
        retry,
        retryDelay: (failureCount: number, failure: unknown) =>
          defaultRetryDelay(definitions, failureCount, failure),
      });

      let cached: PaginatedState<TItem, TError>;

      const refetchState = async (): Promise<PaginatedState<TItem, TError>> => {
        // InfiniteQueryObserver.refetch replays every loaded page
        // SEQUENTIALLY (each page's cursor comes from the previous page's
        // fresh response) — the whole loaded window converges, not just
        // page one.
        await observer.refetch();
        cached = projectPaginated(observer.getCurrentResult());
        return cached;
      };
      const refetch = async (): Promise<void> => {
        await refetchState();
      };
      const fetchNextState = async (): Promise<PaginatedState<TItem, TError>> => {
        const current = observer.getCurrentResult();
        if (!current.hasNextPage || current.isFetchingNextPage) return cached;
        const observed = await observer.fetchNextPage();
        cached = projectPaginated(observed);
        return cached;
      };
      const fetchNext = async (): Promise<void> => {
        await fetchNextState();
      };

      const projectPaginated = (observed: {
        readonly fetchStatus: FetchState;
        readonly failureCount: number;
        readonly isStale: boolean;
        readonly dataUpdatedAt: number;
        readonly data: { readonly pages: readonly TPage[] } | undefined;
        readonly status: "pending" | "success" | "error";
        readonly error: TError | null;
        readonly hasNextPage: boolean;
        readonly isFetchingNextPage: boolean;
      }): PaginatedState<TItem, TError> => {
        const rows = flattenPages(observed.data);
        const controls: PaginatedControls = {
          fetch: observed.fetchStatus,
          failureCount: observed.failureCount,
          isStale: observed.isStale,
          updatedAt: observed.dataUpdatedAt,
          pageCount: observed.data?.pages.length ?? 0,
          hasNext: observed.hasNextPage,
          fetchingNext: observed.isFetchingNextPage,
          refetch,
          fetchNext,
        };
        if (observed.status === "pending") {
          return { ...controls, state: "pending" };
        }
        if (observed.status === "success") {
          return { ...controls, state: "success", rows: rows ?? [] };
        }
        if (!isTaggedError(observed.error)) {
          throw new TypeError("Query engine received an untagged failure");
        }
        return {
          ...controls,
          state: "failure",
          error: observed.error,
          ...(rows === undefined ? {} : { previous: rows }),
        };
      };
      cached = projectPaginated(observer.getCurrentResult());

      return {
        key,
        getCurrentState: () => cached,
        subscribe: (listener: () => void) =>
          observer.subscribe((observed) => {
            cached = projectPaginated(observed);
            listener();
          }),
        refetch: refetchState,
        fetchNext: fetchNextState,
        destroy: () => observer.destroy(),
      };
    },
    prefetchPaginated: async (procedure, input, prefetchOptions) => {
      const observer = runtime.observePaginated(procedure, input, prefetchOptions);
      try {
        const state = await observer.refetch();
        if (state.state === "pending") {
          throw new TypeError("Prefetch did not settle");
        }
        return state.state === "success" ? ok(state.rows) : err(state.error);
      } finally {
        observer.destroy();
      }
    },
    mutation: <TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(
      procedure: TProcedureClient,
      mutationOptions: MutationOptions<
        ProcedureClientInput<TProcedureClient>,
        ProcedureClientOutput<TProcedureClient>,
        ProcedureClientError<TProcedureClient>,
        TContext
      > = {},
    ) => {
      type TInput = ProcedureClientInput<TProcedureClient>;
      type TOutput = ProcedureClientOutput<TProcedureClient>;
      type TError = ProcedureClientError<TProcedureClient>;

      const metadata = metadataFor(procedure);
      if (metadata.procedure._def.kind !== "mutation") {
        throw new TypeError(`${metadata.path} is not a mutation procedure`);
      }
      const definitions: ErrorDefinitionMap = metadata.procedure._def.definitions;
      const declaredAffects: readonly AffectsEntry[] = metadata.procedure._def.affects ?? [];
      const declaredWrites: readonly WritesEntry[] = metadata.procedure._def.writes ?? [];
      let activeController: AbortController | undefined;
      // Read retry lazily on every attempt: React callers hand in a fresh
      // options object per render, and the current value must win.
      const retry = (failureCount: number, failure: unknown) => {
        if (!metadata.errors.is(failure)) return false;
        return shouldRetryMutation(definitions, mutationOptions.retry, failureCount, failure);
      };

      let lastTouched: readonly EntityCacheKey[] | undefined;
      let lastStartSeq = 0;
      const observer = new MutationObserver<TOutput, TError, TInput, TContext | undefined>(
        queryClient,
        {
          mutationKey: [metadata.path],
          mutationFn: async (input) => {
            // Request-start order is the write order the guard in
            // applyEntityWrites enforces against out-of-order responses.
            lastStartSeq = nextWriteSeq();
            const result = await invokeProcedureClient(procedure, input, {
              signal: activeController!.signal,
            });
            lastTouched = getTouchedEntities(result);
            if (!result.ok) throw result.error;
            return result.value;
          },
          retry,
          retryDelay: (failureCount: number, failure: unknown) =>
            defaultRetryDelay(definitions, failureCount, failure),
          ...(mutationOptions.optimistic === undefined
            ? {}
            : { onMutate: (input: TInput) => mutationOptions.optimistic!(input, cache) }),
          onSuccess: async (value: TOutput, input: TInput, context: TContext | undefined) => {
            // Entities the mutation returned patch every containing query in
            // place — field freshness by identity, zero refetches.
            const written = new Set<EntityCacheKey>(
              collectEntities(value).map((entity) => entityKey(entity.model.name, entity.id)),
            );
            applyEntityWrites(value, lastStartSeq);
            // Server-declared writes (handler `touch`): identity invalidation
            // for cascades and deletes the output cannot mention. Entities the
            // output DID carry were just patched everywhere — refetching those
            // same queries again would be redundant.
            if (lastTouched && lastTouched.length > 0) {
              const cascades = lastTouched.filter((key) => !written.has(key));
              if (cascades.length > 0) void invalidateEntityKeys(cascades);
            }
            // .writes(): identity invalidation for mutations whose output
            // doesn't carry the entity.
            for (const entry of declaredWrites) {
              void cache.invalidateEntity(entry.model, entry.map(input));
            }
            // .affects(): declared membership/blast-radius invalidation.
            for (const entry of declaredAffects) {
              const target = resolveAffectsTarget(entry.target);
              if (!target) continue;
              if (entry.map) {
                void cache.invalidate(target, entry.map(input));
              } else {
                void cache.invalidateAll(target);
              }
            }
            await mutationOptions.onSuccess?.(value, input);
            await mutationOptions.onSettled?.(ok(value), input, context, cache);
          },
          ...(mutationOptions.onFailure === undefined &&
          mutationOptions.onCancel === undefined &&
          mutationOptions.onSettled === undefined
            ? {}
            : {
                onError: async (failure: TError, input: TInput, context: TContext | undefined) => {
                  if (isCancelled(failure)) {
                    return mutationOptions.onCancel?.(input, context, cache);
                  }
                  // Untagged failures are programmer errors travelling by throw —
                  // they never enter the tagged callback channel.
                  if (!metadata.errors.is(failure)) return undefined;
                  await mutationOptions.onFailure?.(failure, input, context, cache);
                  await mutationOptions.onSettled?.(err(failure), input, context, cache);
                },
              }),
        },
      );

      let cached: MutationState<TInput, TOutput, TError>;
      const mutate = async (input: TInput): Promise<Result<TOutput, TError>> => {
        activeController?.abort();
        activeController = new AbortController();
        try {
          return ok(await observer.mutate(input));
        } catch (failure) {
          if (isCancelled(failure)) {
            observer.reset();
            throw failure;
          }
          if (!metadata.errors.is(failure)) throw failure;
          return err(failure);
        }
      };
      const cancel = () => activeController?.abort();
      const reset = () => {
        cancel();
        observer.reset();
      };
      const projectMutation = (
        observed: MutationObserverResult<TOutput, TError, TInput, TContext | undefined>,
      ): MutationState<TInput, TOutput, TError> => {
        const controls = {
          ...(observed.variables === undefined ? {} : { variables: observed.variables }),
          mutate,
          cancel,
          reset,
        };
        switch (observed.status) {
          case "idle":
            return { ...controls, state: "idle" };
          case "pending":
            return {
              ...controls,
              state: "pending",
              variables: observed.variables,
            };
          case "success":
            return {
              ...controls,
              state: "success",
              value: observed.data,
              variables: observed.variables,
            };
          case "error": {
            if (isCancelled(observed.error)) {
              return { ...controls, state: "idle" };
            }
            if (!metadata.errors.is(observed.error)) {
              // A programmer error — e.g. input the client's own codec
              // rejects — travels by throw: the mutate() promise already
              // rejected with it. Projecting a failure state would launder
              // it into the tagged channel; reset to idle instead.
              return { ...controls, state: "idle" };
            }
            return {
              ...controls,
              state: "failure",
              error: observed.error,
              variables: observed.variables,
            };
          }
        }
      };
      cached = projectMutation(observer.getCurrentResult());

      return {
        getCurrentState: () => cached,
        subscribe: (listener) =>
          observer.subscribe((observed) => {
            cached = projectMutation(observed);
            listener();
          }),
        mutate,
        cancel,
        reset,
        destroy: reset,
      };
    },
    subscription: <TProcedureClient extends SubscriptionProcedureClientLike>(
      procedure: TProcedureClient,
      input: SubscriptionClientInput<TProcedureClient>,
      subscriptionOptions: SubscriptionOptions<SubscriptionClientError<TProcedureClient>> = {},
    ) => {
      type TOutput = SubscriptionClientOutput<TProcedureClient>;
      type TError = SubscriptionClientError<TProcedureClient>;
      const metadata = metadataFor(procedure);
      if (!metadata || metadata.procedure._def.kind !== "subscription") {
        throw new TypeError("Expected a result-rpc subscription procedure client");
      }
      const definitions: ErrorDefinitionMap = metadata.procedure._def.definitions;
      // Declared by `.resumable()`. Absent means every reconnect reopens the
      // stream from the top, which is the pre-existing behaviour.
      const eventIdOf = metadata.procedure._def.resumable?.eventId as
        | ((value: TOutput) => string)
        | undefined;
      let lastEventId: string | undefined;
      const listeners = new Set<() => void>();
      let currentStream: ResultSubscription<TOutput, TError> | undefined;
      let generation = 0;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      let removeOnlineListener: (() => void) | undefined;
      let state: SubscriptionState<TOutput, TError>;
      const notify = () => listeners.forEach((listener) => listener());
      const close = () => {
        generation += 1;
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        removeOnlineListener?.();
        removeOnlineListener = undefined;
        currentStream?.close();
        currentStream = undefined;
        state = { ...state, connection: "closed" };
        notify();
      };
      const connect = (reset = true, failureCount = 0) => {
        generation += 1;
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        removeOnlineListener?.();
        removeOnlineListener = undefined;
        const activeGeneration = generation;
        // `reset` means a new subscription (first mount, changed input), not a
        // recovered one — resuming another list's position would be wrong.
        if (reset) lastEventId = undefined;
        currentStream?.close();
        currentStream = undefined;
        state = {
          connection: getOnlineSnapshot() ? "connecting" : "paused",
          result: reset ? undefined : state.result,
          eventCount: reset ? 0 : state.eventCount,
          reconnect: connect,
          close,
        };
        notify();
        // Connectivity is cause-side information: while the browser says it
        // is offline, opening a stream can only manufacture a known failure
        // and burn a request. Pause before transport and resume once online.
        if (!getOnlineSnapshot()) {
          const unsubscribe = subscribeConnectivity((event) => {
            if (event !== "online") return;
            unsubscribe();
            removeOnlineListener = undefined;
            connect(false, failureCount);
          });
          removeOnlineListener = unsubscribe;
          return;
        }
        currentStream = invokeSubscriptionClient(procedure, input, lastEventId);
        void (async () => {
          try {
            for await (const result of currentStream!) {
              if (generation !== activeGeneration) return;
              if (!result.ok) {
                if (result.error._tag === "client/offline") {
                  state = { ...state, connection: "paused" };
                  notify();
                  const unsubscribe = subscribeConnectivity((event) => {
                    if (event !== "online") return;
                    unsubscribe();
                    removeOnlineListener = undefined;
                    connect(false, failureCount);
                  });
                  removeOnlineListener = unsubscribe;
                  return;
                }
                const configured = subscriptionOptions.retry;
                const shouldRetry =
                  configured === undefined
                    ? defaultShouldRetry(definitions, failureCount, result.error)
                    : typeof configured === "function"
                      ? configured(result.error, failureCount)
                      : configured !== false && failureCount < configured;
                if (shouldRetry) {
                  state = { ...state, connection: "reconnecting" };
                  notify();
                  const delay =
                    typeof subscriptionOptions.retryDelayMs === "function"
                      ? subscriptionOptions.retryDelayMs(failureCount + 1)
                      : (subscriptionOptions.retryDelayMs ?? 1_000);
                  retryTimer = setTimeout(
                    () => connect(false, failureCount + 1),
                    Math.max(0, delay),
                  );
                  return;
                }
              }
              // A live event carries decoded (branded) entities exactly like
              // a mutation output does — patch every cached query holding
              // the same identities, so the header updates when the stream
              // says so, not when something refetches. Events take a fresh
              // sequence at arrival: stream order is respected, and a slower
              // mutation response from before the event cannot regress it.
              if (result.ok) {
                applyEntityWrites(result.value, nextWriteSeq());
                // Derived from the value the client just decoded, using the
                // same declared function the server side would apply — which
                // is why no event id has to ride the wire frame.
                if (eventIdOf) lastEventId = eventIdOf(result.value);
              }
              state = {
                ...state,
                connection: result.ok ? "open" : "closed",
                result,
                eventCount: state.eventCount + (result.ok ? 1 : 0),
              };
              notify();
              if (!result.ok) return;
            }
            if (generation === activeGeneration) {
              state = { ...state, connection: "closed" };
              notify();
            }
          } catch (failure) {
            if (!isCancelled(failure))
              queueMicrotask(() => {
                throw failure;
              });
          }
        })();
      };
      state = {
        connection: "connecting",
        result: undefined,
        eventCount: 0,
        reconnect: connect,
        close,
      };
      return {
        getCurrentState: () => state,
        subscribe: (listener) => {
          const shouldConnect = listeners.size === 0;
          listeners.add(listener);
          // Starting a network stream is an effect, not render work. This
          // also means React StrictMode can discard a render-created observer
          // without leaking a request from an object that never committed.
          if (shouldConnect) connect();
          return () => {
            listeners.delete(listener);
            if (listeners.size === 0) close();
          };
        },
        reconnect: connect,
        close,
      };
    },
    dehydrate: () => {
      const dehydrated = dehydrateQueryClient(queryClient, {
        // A declared domain failure is the answer, not a failed prefetch: a
        // server-rendered detail page for a row that does not exist should say
        // so on first paint rather than after a client round-trip. Framework
        // and transport failures stay out — those are transient facts about one
        // attempt, and baking one in would strand the client on a stale verdict.
        shouldDehydrateQuery: (query) =>
          query.state.status === "success" || isDehydratableFailure(query.state.error),
        shouldDehydrateMutation: () => false,
      });
      // TanStack spreads `query.state`, so the live TaggedError instance would
      // ride along; the serializer rejects class instances by design. Send the
      // same wire form the transport would, and reify on the way back in.
      // A success carries `error: null`, not `undefined`, so test for the thing
      // being converted rather than for absence.
      // A success carries `error: null`, not `undefined`, so test for the thing
      // being converted rather than for absence. `fetchFailureReason` holds the
      // same instance and is a retry detail about one attempt, not part of the
      // answer, so it is dropped rather than translated.
      const queries = dehydrated.queries.map((query) =>
        isTaggedError(query.state.error)
          ? {
              ...query,
              state: {
                ...query.state,
                error: query.state.error.toJSON(),
                fetchFailureReason: null,
              },
            }
          : query,
      );
      const encoded = serialize({ ...dehydrated, queries }, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
      if (!encoded.ok) throw new TypeError("Query cache is not wire-serializable");
      return {
        v: 1,
        serializer: SERIALIZER_VERSION,
        contract: contractVersion,
        payload: encoded.value,
      };
    },
    hydrate: (state) => {
      if (state.v !== 1 || state.serializer !== SERIALIZER_VERSION) {
        throw new TypeError("Unsupported result-rpc query cache version");
      }
      if (state.contract !== contractVersion) {
        throw new TypeError(
          `Dehydrated query cache contract ${String(state.contract)} does not match client contract ${contractVersion}`,
        );
      }
      const decoded = deserialize(state.payload, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
      if (!decoded.ok || decoded.value === null || typeof decoded.value !== "object") {
        throw new TypeError("Invalid result-rpc query cache payload");
      }
      // Snapshot every query holding an unreconciled local write before the
      // merge. Comparing the payload's timestamps against ours is not an
      // option — they come from different clocks — so the rule is decided on
      // provenance instead: a confirmed write outranks a snapshot, and the
      // disagreement is settled by a refetch rather than by guessing.
      const pendingLocalWrites = new Map<
        string,
        { readonly key: readonly unknown[]; readonly data: unknown; readonly updatedAt: number }
      >();
      for (const hash of unreconciledLocalWrites) {
        const query = queryClient.getQueryCache().get(hash);
        if (query?.state.status !== "success" || query.state.data === undefined) continue;
        pendingLocalWrites.set(hash, {
          key: query.queryKey,
          data: query.state.data,
          updatedAt: query.state.dataUpdatedAt,
        });
      }
      hydrateQueryClient(queryClient, decoded.value);
      // Normalize every hydrated query through its output codec NOW, not at
      // observe time: decode re-brands the entities, the share pass carries
      // the brands onto the retained objects, and the success event indexes
      // them — so patches and touch-invalidation reach hydrated queries that
      // no component has observed yet.
      const router = getClientRouter(clientIdentity);
      if (router) {
        for (const query of queryClient.getQueryCache().getAll()) {
          const path = query.queryKey[0];
          const procedure = typeof path === "string" ? router.procedures.get(path) : undefined;
          if (!procedure || procedure._def.kind !== "query") continue;
          if (query.state.status === "error") {
            // A dehydrated failure arrives as the wire shape it was sent as.
            // Reify it through the procedure's own registry, exactly like a
            // failure off the transport, so shells claim it and `matchError`
            // narrows it identically whether it was fetched or hydrated.
            const encoded = query.state.error;
            if (isTaggedError(encoded) || !isEncodedTaggedError(encoded)) continue;
            const definition = Object.values(procedure._def.definitions as ErrorDefinitionMap).find(
              (candidate) => candidate.tag === encoded._tag,
            );
            const reified = definition?.decode(encoded);
            if (reified?.ok) query.setState({ error: reified.value as Error });
            else queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
            continue;
          }
          if (query.state.status !== "success" || query.state.data === undefined) continue;
          const pagination = procedure._def.pagination;
          if (pagination) {
            // Paginated entries hold InfiniteData — normalize page by page
            // through the page codec so every row re-brands and re-indexes.
            const normalized = normalizeInfiniteData(
              query.state.data,
              procedure._def.output.decode,
            );
            if (!normalized) {
              queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
            } else {
              const wasInvalidated = query.state.isInvalidated;
              queryClient.setQueryData(query.queryKey, normalized, {
                updatedAt: query.state.dataUpdatedAt,
              });
              if (wasInvalidated) query.invalidate();
            }
            continue;
          }
          const normalized = procedure._def.output.decode(query.state.data);
          if (!normalized.ok) {
            queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
          } else {
            const wasInvalidated = query.state.isInvalidated;
            queryClient.setQueryData(query.queryKey, normalized.value, {
              updatedAt: query.state.dataUpdatedAt,
            });
            if (wasInvalidated) query.invalidate();
          }
        }
      }
      for (const [hash, saved] of pendingLocalWrites) {
        const query = queryClient.getQueryCache().get(hash);
        if (!query || query.state.data === saved.data) continue;
        // The payload disagreed with a confirmed write. Keep the write visible
        // and mark the query for reconciliation: showing the older snapshot
        // under staleTime would strand it with no path back to the truth.
        suppressReindex += 1;
        try {
          queryClient.setQueryData(saved.key, saved.data, { updatedAt: saved.updatedAt });
        } finally {
          suppressReindex -= 1;
        }
        unreconciledLocalWrites.add(hash);
        query.invalidate();
      }
    },
    clear: () => {
      queryClient.unmount();
      queryClient.clear();
      entityToQueries.clear();
      queryToEntities.clear();
      queryKeyByHash.clear();
      entityWriteSeq.clear();
    },
  };
  return runtime;
};

import {
  CancelledError,
  dehydrate as dehydrateQueryClient,
  hydrate as hydrateQueryClient,
  MutationObserver,
  onlineManager,
  QueryClient,
  QueryObserver,
  type QueryObserverResult,
  type MutationObserverResult,
} from "@tanstack/query-core";
import type { AnyTaggedError, AnyErrorDefinition } from "../error.js";
import { getOnlineSnapshot, subscribeConnectivity } from "../connectivity.js";

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
import { frameworkErrorDefinitions } from "../framework-errors.js";
import { err, ok, type Result } from "../result.js";
import {
  DEFAULT_MAX_WIRE_BYTES,
  deserialize,
  serialize,
  SERIALIZER_VERSION,
} from "../serializer.js";
import {
  getClientIdentity,
  getClientRouter,
  getProcedureClientMetadata,
  getTouchedEntities,
} from "../client/client.js";
import type { AffectsEntry, WritesEntry } from "../server/contract.js";
import {
  collectEntities,
  entityIdFor,
  entityKey,
  mergeByExistingKeys,
  patchEntity,
  shareStructural,
  type AnyModel,
  type ModelKeyInput,
  type ModelValue,
} from "../model.js";
import type { ResultSubscription } from "../client/client.js";
import { isCancelled } from "../client/transport.js";
import type { ErrorDefinitionMap } from "../server/contract.js";
export type ResultQueryKey = readonly [path: string, encodedInput: string];

type ProcedureClientLike = (
  input: any,
  options?: { readonly signal?: AbortSignal },
) => Promise<Result<any, AnyTaggedError>>;
type QueryProcedureClientLike = ProcedureClientLike & { readonly $kind: "query" };
type MutationProcedureClientLike = ProcedureClientLike & { readonly $kind: "mutation" };
type SubscriptionProcedureClientLike = ((
  input: any,
  options?: { readonly signal?: AbortSignal },
) => ResultSubscription<any, AnyTaggedError>) & { readonly $kind: "subscription" };

export type SubscriptionClientInput<TProcedureClient> =
  TProcedureClient extends (input: infer TInput, ...rest: any[]) => unknown ? TInput : never;
export type SubscriptionClientOutput<TProcedureClient> =
  TProcedureClient extends (...args: any[]) => ResultSubscription<infer T, any>
    ? T
    : never;
export type SubscriptionClientError<TProcedureClient> =
  TProcedureClient extends (...args: any[]) => ResultSubscription<any, infer E>
    ? E
    : never;

export type ProcedureClientInput<TProcedureClient> =
  TProcedureClient extends (input: infer TInput, ...rest: any[]) => unknown
    ? TInput
    : never;

export type ProcedureClientResult<TProcedureClient> =
  TProcedureClient extends (...args: any[]) => Promise<infer TReturn>
    ? TReturn
    : never;

export type ProcedureClientOutput<TProcedureClient> =
  ProcedureClientResult<TProcedureClient> extends Result<infer TOutput, AnyTaggedError>
    ? TOutput
    : never;

export type ProcedureClientError<TProcedureClient> =
  ProcedureClientResult<TProcedureClient> extends Result<unknown, infer TError>
    ? TError
    : never;

export type FetchState = "idle" | "fetching" | "paused";

interface QueryControls<T, E extends AnyTaggedError> {
  readonly fetch: FetchState;
  readonly failureCount: number;
  readonly isStale: boolean;
  readonly updatedAt: number;
  refetch(): Promise<QueryState<T, E>>;
}

export type QueryState<T, E extends AnyTaggedError> =
  | (QueryControls<T, E> & Readonly<{
      state: "pending";
      value?: undefined;
      error?: undefined;
    }>)
  | (QueryControls<T, E> & Readonly<{
      state: "success";
      value: T;
      error?: undefined;
    }>)
  | (QueryControls<T, E> & Readonly<{
      state: "failure";
      error: E;
      value?: undefined;
      previous?: T;
    }>);

export interface QueryOptions<E extends AnyTaggedError> {
  readonly enabled?: boolean;
  readonly staleTime?: number;
  readonly gcTime?: number;
  readonly retry?: false | number | ((error: E, failureCount: number) => boolean);
}

export interface ResultQueryObserver<T, E extends AnyTaggedError> {
  readonly key: ResultQueryKey;
  getCurrentState(): QueryState<T, E>;
  subscribe(listener: () => void): () => void;
  refetch(): Promise<QueryState<T, E>>;
  destroy(): void;
}

interface MutationControls<TInput, TOutput, TError extends AnyTaggedError> {
  readonly variables?: TInput;
  mutate(input: TInput): Promise<Result<TOutput, TError>>;
  cancel(): void;
  reset(): void;
}

export type MutationState<TInput, TOutput, TError extends AnyTaggedError> =
  | (MutationControls<TInput, TOutput, TError> & Readonly<{
      state: "idle";
      value?: undefined;
      error?: undefined;
    }>)
  | (MutationControls<TInput, TOutput, TError> & Readonly<{
      state: "pending";
      value?: undefined;
      error?: undefined;
      variables: TInput;
    }>)
  | (MutationControls<TInput, TOutput, TError> & Readonly<{
      state: "success";
      value: TOutput;
      error?: undefined;
      variables: TInput;
    }>)
  | (MutationControls<TInput, TOutput, TError> & Readonly<{
      state: "failure";
      error: TError;
      value?: undefined;
      variables: TInput;
    }>);

export interface MutationOptions<
  TInput,
  TOutput,
  TError extends AnyTaggedError,
  TContext = undefined,
> {
  readonly retry?: false | number | ((error: TError, failureCount: number) => boolean);
  readonly optimistic?: (
    input: TInput,
    cache: QueryCache,
  ) => TContext | Promise<TContext>;
  readonly onSuccess?: (value: TOutput, input: TInput) => void | Promise<void>;
  readonly onFailure?: (
    error: TError,
    input: TInput,
    context: TContext | undefined,
    cache: QueryCache,
  ) => void | Promise<void>;
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
  key<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
    input: ProcedureClientInput<TProcedureClient>,
  ): ResultQueryKey;
  get<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
    input: ProcedureClientInput<TProcedureClient>,
  ): ProcedureClientOutput<TProcedureClient> | undefined;
  update<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
    input: ProcedureClientInput<TProcedureClient>,
    updater: (
      current: ProcedureClientOutput<TProcedureClient> | undefined,
    ) => ProcedureClientOutput<TProcedureClient> | undefined,
  ): () => void;
  invalidate<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
    input: ProcedureClientInput<TProcedureClient>,
  ): Promise<void>;
  invalidateAll<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
  ): Promise<void>;
  /** Invalidates every cached query whose result contains the entity. */
  invalidateEntity(model: AnyModel, id: ModelKeyInput): Promise<void>;
  /**
   * Patches the entity in place everywhere it appears — one call updates the
   * detail view, every list row, the header. The updater receives the cached
   * value (possibly a projection; treat it as the canonical shape and spread)
   * and its result is merged by the projection rule. Returns a rollback,
   * composing with `optimistic:` exactly like `update`.
   */
  updateEntity<TModel extends AnyModel>(
    model: TModel,
    id: ModelKeyInput,
    updater: (current: ModelValue<TModel>) => ModelValue<TModel>,
  ): () => void;
}

export interface ResultMutationObserver<TInput, TOutput, TError extends AnyTaggedError> {
  getCurrentState(): MutationState<TInput, TOutput, TError>;
  subscribe(listener: () => void): () => void;
  mutate(input: TInput): Promise<Result<TOutput, TError>>;
  cancel(): void;
  reset(): void;
  destroy(): void;
}

export type SubscriptionConnection =
  | "connecting"
  | "open"
  | "reconnecting"
  | "paused"
  | "closed";

export interface SubscriptionOptions<E extends AnyTaggedError> {
  readonly retry?: false | number | ((error: E, failureCount: number) => boolean);
  readonly retryDelayMs?: number | ((failureCount: number) => number);
}

export interface SubscriptionState<T, E extends AnyTaggedError> {
  readonly connection: SubscriptionConnection;
  readonly result: Result<T, E> | undefined;
  readonly eventCount: number;
  reconnect(): void;
  close(): void;
}

export interface ResultSubscriptionObserver<T, E extends AnyTaggedError> {
  getCurrentState(): SubscriptionState<T, E>;
  subscribe(listener: () => void): () => void;
  reconnect(): void;
  close(): void;
}

const isTaggedError = (value: unknown): value is AnyTaggedError =>
  value !== null
  && typeof value === "object"
  && "_tag" in value
  && typeof value._tag === "string"
  && "data" in value;

const definitionFor = (
  definitions: ErrorDefinitionMap,
  failure: AnyTaggedError,
): AnyErrorDefinition | undefined => [
  ...Object.values(definitions),
  ...Object.values(frameworkErrorDefinitions),
].find((definition) => definition.tag === failure._tag);

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

const defaultRetryDelay = (
  definitions: ErrorDefinitionMap,
  failureCount: number,
  failure: unknown,
): number => {
  if (isTaggedError(failure) && definitionFor(definitions, failure)?.policy.retry === "after") {
    const data = failure.data;
    if (
      data !== null
      && typeof data === "object"
      && "retryAfterMs" in data
      && typeof data.retryAfterMs === "number"
    ) return Math.max(0, data.retryAfterMs);
  }
  return Math.min(250 * 2 ** failureCount, 2_000);
};

const project = <T, E extends AnyTaggedError>(
  observed: QueryObserverResult<T, E>,
  refetch: () => Promise<QueryState<T, E>>,
): QueryState<T, E> => {
  const controls: QueryControls<T, E> = {
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
    error: observed.error as E,
    ...(observed.data === undefined ? {} : { previous: observed.data }),
  };
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
  if (state.state === "failure") return err(state.error as AnyTaggedError);
  return undefined;
}

export interface CreateQueryRuntimeOptions<TClient> {
  readonly client: TClient;
}

export interface DehydratedQueryRuntime {
  readonly v: 1;
  readonly serializer: typeof SERIALIZER_VERSION;
  readonly payload: string;
}

export interface QueryRuntime {
  /** The client this runtime was created with. */
  readonly client: unknown;
  readonly cache: QueryCache;
  observe<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
    input: ProcedureClientInput<TProcedureClient>,
    options?: QueryOptions<ProcedureClientError<TProcedureClient>>,
  ): ResultQueryObserver<
    ProcedureClientOutput<TProcedureClient>,
    ProcedureClientError<TProcedureClient>
  >;
  prefetch<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
    input: ProcedureClientInput<TProcedureClient>,
    options?: QueryOptions<ProcedureClientError<TProcedureClient>>,
  ): Promise<ProcedureClientResult<TProcedureClient>>;
  mutation<TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(
    procedure: TProcedureClient,
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
  subscription<TProcedureClient extends SubscriptionProcedureClientLike>(
    procedure: TProcedureClient,
    input: SubscriptionClientInput<TProcedureClient>,
    options?: SubscriptionOptions<SubscriptionClientError<TProcedureClient>>,
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
): QueryRuntime => {
  if (
    (typeof options.client !== "object" && typeof options.client !== "function")
    || options.client === null
  ) throw new TypeError("Expected a result-rpc client");
  const clientIdentity = getClientIdentity(options.client);
  if (!clientIdentity) throw new TypeError("Expected a result-rpc client");
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

  const metadataFor = (procedure: Function) => {
    const metadata = getProcedureClientMetadata(procedure);
    if (!metadata || metadata.clientIdentity !== clientIdentity) {
      throw new TypeError("Procedure client belongs to a different result-rpc client");
    }
    return metadata;
  };

  const queryKey = <TProcedureClient extends ProcedureClientLike>(
    procedure: TProcedureClient,
    input: ProcedureClientInput<TProcedureClient>,
  ): ResultQueryKey => {
    const metadata = metadataFor(procedure);
    if (metadata.procedure._def.kind !== "query") {
      throw new TypeError(`${metadata.path} is not a query procedure`);
    }
    const encoded = metadata.procedure._def.input.encode(input ?? {});
    if (!encoded.ok) throw new TypeError(`Invalid query input for ${metadata.path}`);
    const serialized = serialize(encoded.value, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
    if (!serialized.ok) throw new TypeError(`Query input for ${metadata.path} is not serializable`);
    return [metadata.path, serialized.value] as const;
  };

  // --- Entity index: entityKey ↔ cached queries containing it ---------------
  // Maintained from query-cache events; every success value is walked for
  // branded entity objects (the decode pass branded them).
  const entityToQueries = new Map<string, Set<string>>();
  const queryToEntities = new Map<string, Set<string>>();
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
    const keys = new Set<string>();
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

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "added") reindexQuery(event.query);
    else if (event.type === "updated") {
      if (suppressReindex > 0) return;
      // Only data-bearing updates can change entity membership; fetchStatus
      // flips, invalidation marks, and errors would re-walk unchanged data.
      const action = (event as { readonly action?: { readonly type?: string } }).action;
      if (action?.type === "success") reindexQuery(event.query);
    } else if (event.type === "removed") dropQueryFromIndex(event.query.queryHash);
  });

  const queriesContaining = (model: AnyModel, id: string): readonly string[] =>
    [...(entityToQueries.get(entityKey(model.name, id)) ?? [])];

  /**
   * Write-through: replace the entity wherever it appears, by the projection
   * rule. Falls back to nothing when the merge changes nothing — a patch that
   * cannot apply is simply not a patch.
   */
  const patchOneQuery = (
    queryKey: readonly unknown[],
    model: AnyModel,
    id: string,
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
    if (wasInvalidated) query?.invalidate();
    return true;
  };

  const patchQueriesWith = (
    model: AnyModel,
    id: string,
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
      const captured = collectEntities(previous)
        .find((entity) => entity.model === model && entity.id === id)?.value;
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
        patchOneQuery(queryKey, model, id, (current) =>
          mergeByExistingKeys(current, captured));
      });
    }
    return restores;
  };

  /** Invalidate every query containing any of the entity keys (`model:id`). */
  const invalidateEntityKeys = (keys: readonly string[]): Promise<void> =>
    Promise.all(keys.flatMap((key) =>
      [...(entityToQueries.get(key) ?? [])].map((hash) => {
        const queryKey = queryKeyByHash.get(hash);
        return queryKey
          ? queryClient.invalidateQueries({ queryKey, exact: true })
          : Promise.resolve();
      }))).then(() => undefined);

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
  const entityWriteSeq = new Map<string, number>();

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
        mergeByExistingKeys(current, entity.value));
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
      const candidate = procedure as { readonly _def: typeof target._def };
      const matches = procedure === (target as unknown)
        || candidate._def === target._def
        || (candidate._def.kind === "query"
          && candidate._def.input === target._def.input
          && candidate._def.output === target._def.output);
      if (!matches) continue;
      let node: unknown = options.client;
      for (const segment of path.split(".")) {
        node = (node as Record<string, unknown>)[segment];
      }
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
      const restores = patchQueriesWith(model, resolved, (current) =>
        mergeByExistingKeys(
          current,
          updater(current as ModelValue<typeof model>) as Record<string, unknown>,
        ));
      return () => {
        for (const restore of restores) restore();
      };
    },
  };

  const runtime: QueryRuntime = {
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

      const encodedInput = metadata.procedure._def.input.encode(input ?? {});
      if (!encodedInput.ok) throw new TypeError(`Invalid query input for ${metadata.path}`);

      const definitions = metadata.procedure._def.definitions as ErrorDefinitionMap;
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
          return isTaggedError(failure) && configured(
            failure as ProcedureClientError<TProcedureClient>,
            failureCount,
          );
        }
        return configured !== false && failureCount < configured;
      };
      const observerOptions = {
        queryKey: key,
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          try {
            const result = await procedure(input, { signal });
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

      const refetch = async (): Promise<QueryState<
        ProcedureClientOutput<TProcedureClient>,
        ProcedureClientError<TProcedureClient>
      >> => {
        const observed = await observer.refetch();
        cached = project(observed, refetch);
        return cached;
      };
      cached = project(observer.getCurrentResult(), refetch);

      return {
        key,
        getCurrentState: () => cached,
        subscribe: (listener) => observer.subscribe((observed) => {
          cached = project(observed, refetch);
          listener();
        }),
        refetch,
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
        return (
          state.state === "success" ? ok(state.value) : err(state.error)
        ) as ProcedureClientResult<typeof procedure>;
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
      const definitions = metadata.procedure._def.definitions as ErrorDefinitionMap;
      const declaredAffects: readonly AffectsEntry[] =
        (metadata.procedure._def as { affects?: readonly AffectsEntry[] }).affects ?? [];
      const declaredWrites: readonly WritesEntry[] =
        (metadata.procedure._def as { writes?: readonly WritesEntry[] }).writes ?? [];
      let activeController: AbortController | undefined;
      // Read retry lazily on every attempt: React callers hand in a fresh
      // options object per render, and the current value must win.
      const retry = (failureCount: number, failure: unknown) => {
        const configured = mutationOptions.retry;
        if (configured === undefined) {
          return defaultShouldRetry(definitions, failureCount, failure);
        }
        if (typeof configured === "function") {
          return isTaggedError(failure) && configured(failure as TError, failureCount);
        }
        return configured !== false && failureCount < configured;
      };

      let lastTouched: readonly string[] | undefined;
      let lastStartSeq = 0;
      const observer = new MutationObserver<TOutput, TError, TInput, TContext>(queryClient, {
        mutationKey: [metadata.path],
        mutationFn: async (input) => {
          // Request-start order is the write order the guard in
          // applyEntityWrites enforces against out-of-order responses.
          lastStartSeq = nextWriteSeq();
          const result = await procedure(input, { signal: activeController!.signal });
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
        onSuccess: (value: TOutput, input: TInput) => {
          // Entities the mutation returned patch every containing query in
          // place — field freshness by identity, zero refetches.
          const written = new Set(
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
            void cache.invalidateEntity(entry.model, (entry.map as (input: TInput) => ModelKeyInput)(input));
          }
          // .affects(): declared membership/blast-radius invalidation.
          for (const entry of declaredAffects) {
            const target = resolveAffectsTarget(entry.target);
            if (!target) continue;
            if (entry.map) {
              void cache.invalidate(target as never, (entry.map as (input: TInput) => never)(input));
            } else {
              void cache.invalidateAll(target as never);
            }
          }
          return mutationOptions.onSuccess?.(value, input);
        },
        ...(mutationOptions.onFailure === undefined && mutationOptions.onCancel === undefined
          ? {}
          : { onError: (failure: TError, input: TInput, context: TContext | undefined) => {
              if (isCancelled(failure)) {
                return mutationOptions.onCancel?.(input, context, cache);
              }
              // Untagged failures are programmer errors travelling by throw —
              // they never enter the tagged callback channel.
              if (!isTaggedError(failure)) return undefined;
              return mutationOptions.onFailure?.(failure, input, context, cache);
            } }),
        ...(
          mutationOptions.onSettled === undefined && mutationOptions.onCancel === undefined
            ? {}
            : { onSettled: (
              value: TOutput | undefined,
              failure: TError | null,
              input: TInput,
              context: TContext | undefined,
            ) => failure !== null && (isCancelled(failure) || !isTaggedError(failure))
              ? undefined
              : mutationOptions.onSettled?.(
                  failure === null ? ok(value as TOutput) : err(failure),
                  input,
                  context,
                  cache,
                ) }),
      });

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
          if (!isTaggedError(failure)) throw failure;
          return err(failure as TError);
        }
      };
      const cancel = () => activeController?.abort();
      const reset = () => {
        cancel();
        observer.reset();
      };
      const projectMutation = (
        observed: MutationObserverResult<TOutput, TError, TInput, TContext>,
      ): MutationState<TInput, TOutput, TError> => {
        const controls = {
          ...(observed.variables === undefined ? {} : { variables: observed.variables }),
          mutate,
          cancel,
          reset,
        };
        switch (observed.status) {
          case "idle": return { ...controls, state: "idle" };
          case "pending": return {
            ...controls,
            state: "pending",
            variables: observed.variables,
          };
          case "success": return {
            ...controls,
            state: "success",
            value: observed.data,
            variables: observed.variables,
          };
          case "error": {
            if (isCancelled(observed.error)) {
              return { ...controls, state: "idle" };
            }
            if (!isTaggedError(observed.error)) {
              // A programmer error — e.g. input the client's own codec
              // rejects — travels by throw: the mutate() promise already
              // rejected with it. Projecting a failure state would launder
              // it into the tagged channel; reset to idle instead.
              return { ...controls, state: "idle" };
            }
            return {
              ...controls,
              state: "failure",
              error: observed.error as TError,
              variables: observed.variables,
            };
          }
        }
      };
      cached = projectMutation(observer.getCurrentResult());

      return {
        getCurrentState: () => cached,
        subscribe: (listener) => observer.subscribe((observed) => {
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
      const definitions = metadata.procedure._def.definitions as ErrorDefinitionMap;
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
        removeOnlineListener?.();
        removeOnlineListener = undefined;
        currentStream?.close();
        state = { ...state, connection: "closed" };
        notify();
      };
      const connect = (reset = true, failureCount = 0) => {
        generation += 1;
        removeOnlineListener?.();
        removeOnlineListener = undefined;
        const activeGeneration = generation;
        currentStream?.close();
        state = {
          connection: "connecting",
          result: reset ? undefined : state.result,
          eventCount: reset ? 0 : state.eventCount,
          reconnect: connect,
          close,
        };
        notify();
        currentStream = procedure(input) as ResultSubscription<TOutput, TError>;
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
                const shouldRetry = configured === undefined
                  ? defaultShouldRetry(definitions, failureCount, result.error)
                  : typeof configured === "function"
                    ? configured(result.error, failureCount)
                    : configured !== false && failureCount < configured;
                if (shouldRetry) {
                  state = { ...state, connection: "reconnecting" };
                  notify();
                  const delay = typeof subscriptionOptions.retryDelayMs === "function"
                    ? subscriptionOptions.retryDelayMs(failureCount + 1)
                    : subscriptionOptions.retryDelayMs ?? 1_000;
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
              if (result.ok) applyEntityWrites(result.value, nextWriteSeq());
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
            if (!isCancelled(failure)) queueMicrotask(() => { throw failure; });
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
      connect();
      return {
        getCurrentState: () => state,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        reconnect: connect,
        close,
      };
    },
    dehydrate: () => {
      const dehydrated = dehydrateQueryClient(queryClient, {
        shouldDehydrateQuery: (query) => query.state.status === "success",
        shouldDehydrateMutation: () => false,
      });
      const encoded = serialize(dehydrated, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
      if (!encoded.ok) throw new TypeError("Query cache is not wire-serializable");
      return { v: 1, serializer: SERIALIZER_VERSION, payload: encoded.value };
    },
    hydrate: (state) => {
      if (state.v !== 1 || state.serializer !== SERIALIZER_VERSION) {
        throw new TypeError("Unsupported result-rpc query cache version");
      }
      const decoded = deserialize(state.payload, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
      if (!decoded.ok || decoded.value === null || typeof decoded.value !== "object") {
        throw new TypeError("Invalid result-rpc query cache payload");
      }
      hydrateQueryClient(queryClient, decoded.value as never);
      // Normalize every hydrated query through its output codec NOW, not at
      // observe time: decode re-brands the entities, the share pass carries
      // the brands onto the retained objects, and the success event indexes
      // them — so patches and touch-invalidation reach hydrated queries that
      // no component has observed yet.
      const router = getClientRouter(clientIdentity);
      if (router) {
        for (const query of queryClient.getQueryCache().getAll()) {
          if (query.state.status !== "success" || query.state.data === undefined) continue;
          const path = query.queryKey[0];
          const procedure = typeof path === "string"
            ? router.procedures.get(path)
            : undefined;
          if (!procedure || procedure._def.kind !== "query") continue;
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

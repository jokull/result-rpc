import {
  CancelledError,
  dehydrate as dehydrateQueryClient,
  hydrate as hydrateQueryClient,
  MutationObserver,
  QueryClient,
  QueryObserver,
  type QueryObserverResult,
  type MutationObserverResult,
} from "@tanstack/query-core";
import type { AnyTaggedError, AnyErrorDefinition } from "../error.js";
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
  entityKey,
  mergeByExistingKeys,
  patchEntity,
  type AnyModel,
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
      result: undefined;
    }>)
  | (QueryControls<T, E> & Readonly<{
      state: "success";
      result: Readonly<{ ok: true; value: T }>;
    }>)
  | (QueryControls<T, E> & Readonly<{
      state: "failure";
      result: Readonly<{ ok: false; error: E }>;
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
      result: undefined;
    }>)
  | (MutationControls<TInput, TOutput, TError> & Readonly<{
      state: "pending";
      result: undefined;
      variables: TInput;
    }>)
  | (MutationControls<TInput, TOutput, TError> & Readonly<{
      state: "success";
      result: Readonly<{ ok: true; value: TOutput }>;
      variables: TInput;
    }>)
  | (MutationControls<TInput, TOutput, TError> & Readonly<{
      state: "failure";
      result: Readonly<{ ok: false; error: TError }>;
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
  invalidateEntity(model: AnyModel, id: string): Promise<void>;
  /**
   * Patches the entity in place everywhere it appears — one call updates the
   * detail view, every list row, the header. The updater receives the cached
   * value (possibly a projection; treat it as the canonical shape and spread)
   * and its result is merged by the projection rule. Returns a rollback,
   * composing with `optimistic:` exactly like `update`.
   */
  updateEntity<TModel extends AnyModel>(
    model: TModel,
    id: string,
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
    return { ...controls, state: "pending", result: undefined };
  }
  if (observed.status === "success") {
    return { ...controls, state: "success", result: ok(observed.data) };
  }
  if (!isTaggedError(observed.error)) {
    throw new TypeError("Query engine received an untagged failure");
  }
  return {
    ...controls,
    state: "failure",
    result: err(observed.error as E),
    ...(observed.data === undefined ? {} : { previous: observed.data }),
  };
};

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
  const queryClient = new QueryClient();

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

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "added" || event.type === "updated") reindexQuery(event.query);
    else if (event.type === "removed") dropQueryFromIndex(event.query.queryHash);
  });

  const queriesContaining = (model: AnyModel, id: string): readonly string[] =>
    [...(entityToQueries.get(entityKey(model.name, id)) ?? [])];

  /**
   * Write-through: replace the entity wherever it appears, by the projection
   * rule. Falls back to nothing when the merge changes nothing — a patch that
   * cannot apply is simply not a patch.
   */
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
      const { value, changed } = patchEntity(previous, model, id, produce);
      if (!changed) continue;
      queryClient.setQueryData(queryKey, value);
      restores.push(() => queryClient.setQueryData(queryKey, previous));
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

  /** Mutation output entities drive write-through patches by identity. */
  const applyEntityWrites = (output: unknown): void => {
    for (const entity of collectEntities(output)) {
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
    invalidateEntity: (model, id) => invalidateEntityKeys([entityKey(model.name, id)]),
    updateEntity: (model, id, updater) => {
      const restores = patchQueriesWith(model, id, (current) =>
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
          // Normalize/copy rich values through the declared output codec before trust.
          queryClient.setQueryData(key, decoded.value, {
            updatedAt: hydratedState.dataUpdatedAt,
          });
        }
      }
      const configuredRetry = queryOptions.retry;
      const retry = configuredRetry === undefined
        ? (failureCount: number, failure: unknown) =>
            defaultShouldRetry(definitions, failureCount, failure)
        : typeof configuredRetry === "function"
          ? (failureCount: number, failure: unknown) =>
              isTaggedError(failure)
              && configuredRetry(
                failure as ProcedureClientError<TProcedureClient>,
                failureCount,
              )
          : configuredRetry;
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
        return state.result as ProcedureClientResult<typeof procedure>;
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
      const configuredRetry = mutationOptions.retry;
      const retry = configuredRetry === undefined
        ? (failureCount: number, failure: unknown) =>
            defaultShouldRetry(definitions, failureCount, failure)
        : typeof configuredRetry === "function"
          ? (failureCount: number, failure: unknown) =>
              isTaggedError(failure)
              && configuredRetry(failure as TError, failureCount)
          : configuredRetry;

      let lastTouched: readonly string[] | undefined;
      const observer = new MutationObserver<TOutput, TError, TInput, TContext>(queryClient, {
        mutationKey: [metadata.path],
        mutationFn: async (input) => {
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
          applyEntityWrites(value);
          // Server-declared writes (handler `touch`): identity invalidation
          // for cascades and deletes the output cannot mention.
          if (lastTouched && lastTouched.length > 0) {
            void invalidateEntityKeys(lastTouched);
          }
          // .writes(): identity invalidation for mutations whose output
          // doesn't carry the entity.
          for (const entry of declaredWrites) {
            void cache.invalidateEntity(entry.model, String((entry.map as (input: TInput) => string | number)(input)));
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
          : { onError: (failure: TError, input: TInput, context: TContext | undefined) =>
              isCancelled(failure)
                ? mutationOptions.onCancel?.(input, context, cache)
                : mutationOptions.onFailure?.(failure, input, context, cache) }),
        ...(
          mutationOptions.onSettled === undefined && mutationOptions.onCancel === undefined
            ? {}
            : { onSettled: (
              value: TOutput | undefined,
              failure: TError | null,
              input: TInput,
              context: TContext | undefined,
            ) => failure !== null && isCancelled(failure)
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
          case "idle": return { ...controls, state: "idle", result: undefined };
          case "pending": return {
            ...controls,
            state: "pending",
            result: undefined,
            variables: observed.variables,
          };
          case "success": return {
            ...controls,
            state: "success",
            result: ok(observed.data),
            variables: observed.variables,
          };
          case "error": {
            if (isCancelled(observed.error)) {
              return { ...controls, state: "idle", result: undefined };
            }
            if (!isTaggedError(observed.error)) {
              throw new TypeError("Mutation engine received an untagged failure");
            }
            return {
              ...controls,
              state: "failure",
              result: err(observed.error as TError),
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
                  const target = globalThis as typeof globalThis & {
                    addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void;
                    removeEventListener?: (type: string, listener: () => void) => void;
                  };
                  if (target.addEventListener) {
                    const resume = () => {
                      removeOnlineListener = undefined;
                      connect(false, failureCount);
                    };
                    target.addEventListener("online", resume, { once: true });
                    removeOnlineListener = () => target.removeEventListener?.("online", resume);
                  }
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
    },
    clear: () => {
      queryClient.clear();
      entityToQueries.clear();
      queryToEntities.clear();
      queryKeyByHash.clear();
    },
  };
  return runtime;
};

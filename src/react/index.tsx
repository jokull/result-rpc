"use client";

import {
  createContext,
  createElement,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AnyTaggedError } from "../error.js";
import type { Result } from "../result.js";
import { claimed } from "../client/transport.js";
import {
  getClientEventListener,
  getClientIdentity,
  getProcedureClientMetadata,
} from "../client/client.js";
import {
  claimOwner,
  pauseQueryProjection,
  useAmbientClaim,
  useClaimScope,
  type AmbientClaim,
} from "./claims.js";
import type { ResultSubscription } from "../client/client.js";
import { serialize } from "../serializer.js";
import type {
  PaginatedClientCursor,
  PaginatedClientItem,
  PaginatedClientListInput,
  PaginatedProcedureClientLike,
  PaginatedState,
  ProcedureClientError,
  ProcedureClientInput,
  ProcedureClientOutput,
  MutationOptions,
  MutationState,
  QueryOptions,
  QueryRuntime,
  QueryState,
  SubscriptionClientError,
  SubscriptionClientInput,
  SubscriptionClientOutput,
  SubscriptionState,
  SubscriptionOptions,
  DehydratedQueryRuntime,
} from "../query/runtime.js";

type ProcedureClientLike = (
  input: any,
  options?: { readonly signal?: AbortSignal },
) => Promise<Result<any, AnyTaggedError>>;
export type QueryProcedureClientLike = ProcedureClientLike & { readonly $kind: "query" };
export type MutationProcedureClientLike = ProcedureClientLike & { readonly $kind: "mutation" };
export type SubscriptionProcedureClientLike = ((
  input: any,
  options?: { readonly signal?: AbortSignal },
) => ResultSubscription<any, AnyTaggedError>) & { readonly $kind: "subscription" };

import { createQueryRuntime } from "../query/runtime.js";
export { createQueryRuntime };
export { toResult } from "../query/runtime.js";
export type {
  CreateQueryRuntimeOptions,
  DehydratedQueryRuntime,
  FetchState,
  MutationOptions,
  MutationState,
  PaginatedClientCursor,
  PaginatedClientItem,
  PaginatedClientListInput,
  PaginatedProcedureClientLike,
  PaginatedState,
  QueryCache,
  QueryOptions,
  QueryRuntime,
  QueryState,
  SubscriptionConnection,
  SubscriptionOptions,
  SubscriptionState,
} from "../query/runtime.js";
export { defineShell, getLayerProcedureResolver, layerShell } from "./shell.js";
export { boundaryShells } from "./boundary.js";
export type {
  BoundaryShells,
  BoundaryShellsOptions,
  Connectivity,
  ConnectivityStatus,
} from "./boundary.js";

/** Zero-input procedures may omit the input argument entirely. */
export type QueryHookArgs<TProcedureClient extends QueryProcedureClientLike> =
  undefined extends ProcedureClientInput<TProcedureClient>
    ? [
        input?: ProcedureClientInput<TProcedureClient>,
        options?: QueryOptions<ProcedureClientError<TProcedureClient>>,
      ]
    : [
        input: ProcedureClientInput<TProcedureClient>,
        options?: QueryOptions<ProcedureClientError<TProcedureClient>>,
      ];
export type {
  AnyShell,
  DefineShellOptions,
  ExcludeTags,
  ClaimedBy,
  Shell,
  ShellHoldings,
  ShellEffect,
  LayerShellOptions,
  LayerShellProviderProps,
  TagsOf,
  ValueOf,
} from "./shell.js";

const RuntimeContext = createContext<QueryRuntime | undefined>(undefined);

export type ResultRpcProviderProps = (
  | { readonly runtime: QueryRuntime; readonly client?: undefined }
  | { readonly client: object; readonly runtime?: undefined }
) & {
  /** SSR-dehydrated cache state, applied once per distinct value. */
  readonly hydrate?: DehydratedQueryRuntime;
  readonly children?: ReactNode;
};

/**
 * Provides the query runtime. Pass `client` to let the provider own a runtime
 * for the component's lifetime — the common case. Pass `runtime` when the app
 * needs the instance elsewhere (SSR prefetch, imperative cache access).
 */
export const ResultRpcProvider = (props: ResultRpcProviderProps) => {
  const [owned] = useState(() =>
    props.runtime ?? createQueryRuntime({ client: props.client }));
  const runtime = props.runtime ?? owned;
  const hydrated = useRef<DehydratedQueryRuntime | undefined>(undefined);
  if (props.hydrate !== undefined && hydrated.current !== props.hydrate) {
    hydrated.current = props.hydrate;
    try {
      runtime.hydrate(props.hydrate);
    } catch (cause) {
      warnHydrationSkew(cause);
    }
  }
  return createElement(RuntimeContext.Provider, { value: runtime }, props.children);
};

const useRuntime = (): QueryRuntime => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new TypeError("useResultQuery requires ResultRpcProvider");
  return runtime;
};

let hydrationSkewWarned = false;
const warnHydrationSkew = (cause: unknown) => {
  const isProduction =
    typeof process !== "undefined" && process.env?.["NODE_ENV"] === "production";
  if (isProduction || hydrationSkewWarned) return;
  hydrationSkewWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[result-rpc] skipped hydrating a dehydrated cache — its serializer/contract "
      + "version did not match this client (a server and client bundle briefly "
      + "skewed across a deploy). The client will fetch fresh instead of "
      + "rendering stale server data. Original error: "
      + (cause instanceof Error ? cause.message : String(cause)),
  );
};

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
export const ResultRpcHydrationBoundary = (props: ResultRpcHydrationBoundaryProps) => {
  const runtime = useRuntime();
  const hydrated = useRef<DehydratedQueryRuntime | undefined>(undefined);
  if (props.state !== undefined && hydrated.current !== props.state) {
    hydrated.current = props.state;
    try {
      runtime.hydrate(props.state);
    } catch (cause) {
      warnHydrationSkew(cause);
    }
  }
  return createElement(Fragment, null, props.children);
};

/**
 * The client the enclosing ResultRpcProvider was created with. Annotate the
 * type parameter with your app's client type:
 *
 *     const client = useResultClient<AppClient>()
 */
export const useResultClient = <TClient,>(): TClient => useRuntime().client as TClient;

/** Builds the claim breadcrumb notifier for a procedure, if a listener exists. */
const useClaimNotifier = (procedure: Function) => {
  const runtime = useRuntime();
  const identity = getClientIdentity(runtime.client as object);
  const listener = identity ? getClientEventListener(identity) : undefined;
  const path = getProcedureClientMetadata(procedure)?.path;
  return useMemo(() => {
    if (!listener || path === undefined) return undefined;
    return (
      entry: { readonly name: string; readonly effect: "pause" | "escalate" },
      error: AnyTaggedError,
    ) => listener({
      type: "claimed",
      path,
      tag: error._tag,
      owner: entry.name,
      effect: entry.effect,
    });
  }, [listener, path]);
};

const useResultQueryWithClaim = <TProcedureClient extends QueryProcedureClientLike>(
  procedure: TProcedureClient,
  ...rest: QueryHookArgs<TProcedureClient>
): [
  QueryState<
    ProcedureClientOutput<TProcedureClient>,
    ProcedureClientError<TProcedureClient>
  >,
  AmbientClaim | undefined,
] => {
  const [input, options = {}] = rest as [
    ProcedureClientInput<TProcedureClient>,
    QueryOptions<ProcedureClientError<TProcedureClient>>?,
  ];
  const runtime = useRuntime();
  const inputKey = runtime.cache.key(procedure, input)[1];
  // Options are read through a ref so inline objects (and inline retry
  // functions) never recreate the observer — the current render's values win.
  const queryOptionsRef = useRef(options);
  queryOptionsRef.current = options;
  const observer = useMemo(
    () => runtime.observe(procedure, input, {
      ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
      ...(options.staleTime === undefined ? {} : { staleTime: options.staleTime }),
      ...(options.gcTime === undefined ? {} : { gcTime: options.gcTime }),
      get retry() { return queryOptionsRef.current.retry; },
    } as QueryOptions<ProcedureClientError<TProcedureClient>>),
    [
      runtime,
      procedure,
      inputKey,
      options.enabled,
      options.staleTime,
      options.gcTime,
    ],
  );
  useEffect(() => () => observer.destroy(), [observer]);
  const state = useSyncExternalStore(
    observer.subscribe,
    observer.getCurrentState,
    observer.getCurrentState,
  );
  // Ambient monitor: a failure claimed by any mounted shell never surfaces as
  // a terminal state, no matter which hook observed it.
  const notifyClaim = useClaimNotifier(procedure);
  const refetchRef = useRef(state.refetch);
  refetchRef.current = state.refetch;
  const [retryHeld] = useState(() => () => void refetchRef.current());
  const claim = useAmbientClaim(
    state.state === "failure" ? state.error : undefined,
    notifyClaim,
    retryHeld,
  );
  return [
    claim
      ? (pauseQueryProjection(state) as QueryState<
          ProcedureClientOutput<TProcedureClient>,
          ProcedureClientError<TProcedureClient>
        >)
      : state,
    claim,
  ];
};

export const useResultQuery = <TProcedureClient extends QueryProcedureClientLike>(
  procedure: TProcedureClient,
  ...rest: QueryHookArgs<TProcedureClient>
): QueryState<
  ProcedureClientOutput<TProcedureClient>,
  ProcedureClientError<TProcedureClient>
> => useResultQueryWithClaim(procedure, ...rest)[0];

/**
 * A claim-paused paginated projection: an enclosing shell owns the failure,
 * so this hook shows the previous rows (or pending) while the shell decides.
 * Same doctrine as `pauseQueryProjection` for unary queries.
 */
const pausePaginatedProjection = <TItem, TCursor, E extends AnyTaggedError>(
  state: PaginatedState<TItem, TCursor, E>,
): PaginatedState<TItem, TCursor, never> => {
  const controls = {
    fetch: "paused" as const,
    failureCount: state.failureCount,
    isStale: state.isStale,
    updatedAt: state.updatedAt,
    pageCount: state.pageCount,
    hasNext: state.hasNext,
    fetchingNext: state.fetchingNext,
    refetch: state.refetch as unknown as () => Promise<PaginatedState<TItem, TCursor, never>>,
    fetchNext: state.fetchNext as unknown as () => Promise<PaginatedState<TItem, TCursor, never>>,
  };
  const previous = state.state === "failure" ? state.previous : undefined;
  return previous === undefined
    ? { ...controls, state: "pending" }
    : { ...controls, state: "success", rows: previous };
};

/**
 * Observes a `.paginate()` procedure: one cache entry per list input, every
 * loaded page flattened into `rows` (deduplicated by entity identity),
 * `fetchNext()` to extend, `refetch()` to sequentially converge the whole
 * loaded window. Failures narrow and claim exactly like `useResultQuery`.
 */
export const useResultPaginatedQuery = <TProcedureClient extends PaginatedProcedureClientLike>(
  procedure: TProcedureClient,
  input: PaginatedClientListInput<TProcedureClient>,
  options: QueryOptions<ProcedureClientError<TProcedureClient>> = {},
): PaginatedState<
  PaginatedClientItem<TProcedureClient>,
  PaginatedClientCursor<TProcedureClient>,
  ProcedureClientError<TProcedureClient>
> => {
  const runtime = useRuntime();
  const inputKey = runtime.cache.key(
    procedure as unknown as QueryProcedureClientLike,
    input as never,
  )[1];
  const queryOptionsRef = useRef(options);
  queryOptionsRef.current = options;
  const observer = useMemo(
    () => runtime.observePaginated(procedure, input, {
      ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
      ...(options.staleTime === undefined ? {} : { staleTime: options.staleTime }),
      ...(options.gcTime === undefined ? {} : { gcTime: options.gcTime }),
      get retry() { return queryOptionsRef.current.retry; },
    } as QueryOptions<ProcedureClientError<TProcedureClient>>),
    [
      runtime,
      procedure,
      inputKey,
      options.enabled,
      options.staleTime,
      options.gcTime,
    ],
  );
  useEffect(() => () => observer.destroy(), [observer]);
  const state = useSyncExternalStore(
    observer.subscribe,
    observer.getCurrentState,
    observer.getCurrentState,
  );
  const notifyClaim = useClaimNotifier(procedure);
  const refetchRef = useRef(state.refetch);
  refetchRef.current = state.refetch;
  const [retryHeld] = useState(() => () => void refetchRef.current());
  const claim = useAmbientClaim(
    state.state === "failure" ? state.error : undefined,
    notifyClaim,
    retryHeld,
  );
  return claim
    ? (pausePaginatedProjection(state) as PaginatedState<
        PaginatedClientItem<TProcedureClient>,
        PaginatedClientCursor<TProcedureClient>,
        ProcedureClientError<TProcedureClient>
      >)
    : state;
};

export type SuspenseQueryState<T, E extends AnyTaggedError> = Exclude<
  QueryState<T, E>,
  { readonly state: "pending" }
>;

export const useResultSuspenseQuery = <TProcedureClient extends QueryProcedureClientLike>(
  procedure: TProcedureClient,
  ...rest: QueryHookArgs<TProcedureClient>
): SuspenseQueryState<
  ProcedureClientOutput<TProcedureClient>,
  ProcedureClientError<TProcedureClient>
> => {
  const [input, options = {}] = rest as [
    ProcedureClientInput<TProcedureClient>,
    QueryOptions<ProcedureClientError<TProcedureClient>>?,
  ];
  const [state, claim] = useResultQueryWithClaim(
    procedure,
    ...([input, { ...options, enabled: true }] as QueryHookArgs<TProcedureClient>),
  );
  if (state.state === "pending") {
    // A claim-paused operation resumes when its owner's holdings change, not
    // by refetching in a loop.
    throw claim ? claim.entry.whenChanged() : state.refetch().then(() => undefined);
  }
  return state;
};

export const useResultMutation = <TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(
  procedure: TProcedureClient,
  options: MutationOptions<
    ProcedureClientInput<TProcedureClient>,
    ProcedureClientOutput<TProcedureClient>,
    ProcedureClientError<TProcedureClient>,
    TContext
  > = {},
): MutationState<
  ProcedureClientInput<TProcedureClient>,
  ProcedureClientOutput<TProcedureClient>,
  ProcedureClientError<TProcedureClient>
> => {
  const runtime = useRuntime();
  // The observer is created once per (runtime, procedure); every option is
  // read through a ref at use time. Inline options objects — the way React
  // codebases naturally write them — must never resubscribe or loop.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const observer = useMemo(
    () => runtime.mutation(procedure, {
      get retry() { return optionsRef.current.retry; },
      optimistic: (input, cache) =>
        (optionsRef.current.optimistic
          ? optionsRef.current.optimistic(input, cache)
          : undefined) as TContext,
      onSuccess: (value, input) => optionsRef.current.onSuccess?.(value, input),
      onFailure: (error, input, context, cache) =>
        optionsRef.current.onFailure?.(error, input, context, cache),
      onCancel: (input, context, cache) =>
        optionsRef.current.onCancel?.(input, context, cache),
      onSettled: (result, input, context, cache) =>
        optionsRef.current.onSettled?.(result, input, context, cache),
    } as MutationOptions<
      ProcedureClientInput<TProcedureClient>,
      ProcedureClientOutput<TProcedureClient>,
      ProcedureClientError<TProcedureClient>,
      TContext
    >),
    [runtime, procedure],
  );
  useEffect(() => () => observer.destroy(), [observer]);
  const state = useSyncExternalStore(
    observer.subscribe,
    observer.getCurrentState,
    observer.getCurrentState,
  );
  const scope = useClaimScope();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const stateRef = useRef(state);
  stateRef.current = state;
  const [mutate] = useState(() => async (input: ProcedureClientInput<TProcedureClient>) => {
    const result = await stateRef.current.mutate(input);
    // The caller's continuation must not run on an outcome an enclosing shell
    // owns. Cancellation semantics, but a distinguishable signal: "you
    // cancelled" and "a shell owns this outcome" are different events.
    if (!result.ok) {
      const tag = (result.error as AnyTaggedError)._tag;
      const owner = claimOwner(scopeRef.current, tag);
      if (owner) throw claimed({ tag, owner: owner.name });
    }
    return result;
  });
  const notifyClaim = useClaimNotifier(procedure);
  // On shell resume a held mutation RESETS instead of replaying: the failure
  // was already delivered to the caller as the claimed rejection, and firing
  // a side effect again is never the shell's call. Resetting ends the pause
  // arc so holdings (and the connection banner) drain on reconnect.
  const [resetHeld] = useState(() => () => stateRef.current.reset());
  const claim = useAmbientClaim(
    state.state === "failure" ? (state.error as AnyTaggedError) : undefined,
    notifyClaim,
    resetHeld,
  );
  if (!claim) return { ...state, mutate };
  return {
    ...(state.variables === undefined ? {} : { variables: state.variables }),
    mutate,
    cancel: state.cancel,
    reset: state.reset,
    state: "idle" as const,
  };
};

export const useResultSubscription = <
  TProcedureClient extends SubscriptionProcedureClientLike,
>(
  procedure: TProcedureClient,
  input: SubscriptionClientInput<TProcedureClient>,
  options: SubscriptionOptions<SubscriptionClientError<TProcedureClient>> = {},
): SubscriptionState<
  SubscriptionClientOutput<TProcedureClient>,
  SubscriptionClientError<TProcedureClient>
> => {
  const runtime = useRuntime();
  const encodedInput = serialize(input);
  if (!encodedInput.ok) throw new TypeError("Subscription input is not wire-serializable");
  const observer = useMemo(
    () => runtime.subscription(procedure, input, options),
    [runtime, procedure, encodedInput.value, options.retry, options.retryDelayMs],
  );
  useEffect(() => () => observer.close(), [observer]);
  const state = useSyncExternalStore(
    observer.subscribe,
    observer.getCurrentState,
    observer.getCurrentState,
  );
  const failure = state.result && !state.result.ok
    ? (state.result.error as AnyTaggedError)
    : undefined;
  const notifyClaim = useClaimNotifier(procedure);
  const reconnectRef = useRef(state.reconnect);
  reconnectRef.current = state.reconnect;
  const [retryHeld] = useState(() => () => reconnectRef.current());
  const claim = useAmbientClaim(failure, notifyClaim, retryHeld);
  if (!claim) return state;
  return { ...state, connection: "paused" as const, result: undefined };
};

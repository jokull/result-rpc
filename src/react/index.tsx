"use client";

import {
  createContext,
  createElement,
  Fragment,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SuspenseProps,
} from "react";
import type { AnyTaggedError } from "../error.js";
import type { EmptyObject } from "../wire.js";
import { normalizeClientCallInput } from "../client/base-client.js";
import { claimed } from "../client/transport.js";
import {
  getClientEventListener,
  getClientIdentity,
  getProcedureClientMetadata,
} from "../client/client.js";
import {
  claimOwner,
  createSuspenseClaimLease,
  pauseQueryProjection,
  resolveClaimOwner,
  SuspenseClaimLeaseContext,
  useAmbientClaim,
  useClaimObserver,
  useClaimScope,
  useSuspenseClaimLease,
  type AmbientClaim,
  type SuspenseClaimLease,
} from "./claims.js";
import { serialize } from "../serializer.js";
import { bindLayerShell, type LayerShellFactory } from "./shell.js";
import type {
  PaginatedClientItem,
  PaginatedClientListInput,
  PaginatedProcedureClientLike,
  PaginatedState,
  ProcedureClientError,
  ProcedureClientInput,
  ProcedureClientOutput,
  MutationOptions,
  MutationProcedureClientLike,
  MutationState,
  NarrowProcedureClient,
  QueryOptions,
  QueryProcedureClientLike,
  QueryRuntime,
  QueryState,
  SubscriptionClientError,
  SubscriptionClientInput,
  SubscriptionClientOutput,
  SubscriptionProcedureClientLike,
  SubscriptionState,
  SubscriptionOptions,
  DehydratedQueryRuntime,
} from "../query/runtime.js";

import { createQueryRuntime } from "../query/runtime.js";
import { shouldRetryMutation } from "../query/mutation-retry.js";
export { SERIALIZER_VERSION, toResult } from "../query/runtime.js";
export type {
  AnyModel,
  AnyProcedure,
  AnyProcedureContract,
  AnySubscriptionProcedure,
  AnyUnaryProcedure,
  AnyProcedureClientTypes,
  ClientPaginationTypes,
  ClientProcedure,
  ClientProcedureCapability,
  ClientProcedureError,
  ClientProcedureInput,
  ClientProcedureOutput,
  ProcedureClientTypeCarrier,
  ClientProcedureTypes,
  ClientUnaryTypes,
  CreateQueryRuntimeOptions,
  DehydratedQueryRuntime,
  FetchState,
  MutationOptions,
  MutationProcedureClientLike,
  MutationState,
  MutationStateOf,
  NarrowProcedureClient,
  IsUnion,
  ModelKeyInput,
  ModelDefinition,
  ModelIdentityField,
  ModelKeyRecord,
  ModelProjection,
  ModelValue,
  KeyField,
  ModelSourceMismatch,
  ModelTypeCompatible,
  ModelTypeEqual,
  MutableModelType,
  MismatchedSourceFields,
  PrintModelType,
  PrintModelScalar,
  HasStrictNullChecks,
  NullabilityCaveat,
  SourceFieldMessage,
  SelectedOwnFields,
  SelectionInput,
  SelectionValue,
  ShapeKeySpec,
  SpecificModelKeyInput,
  MutationControls,
  MaybePromise,
  PaginatedClientCursor,
  PaginatedClientItem,
  PaginatedClientListInput,
  PaginatedProcedureClientLike,
  PaginatedState,
  PaginatedStateOf,
  PaginatedControls,
  Page,
  PageRequest,
  ProcedureClientConstraint,
  ProcedureClientError,
  ProcedureClientInput,
  ProcedureClientLike,
  ProcedureClientOutput,
  ProcedureClientResult,
  QueryControls,
  QueryProcedureClientLike,
  QueryCache,
  QueryOptions,
  QueryRuntime,
  QueryState,
  QueryStateOf,
  Result,
  ResultMutationObserver,
  ResultPaginatedObserver,
  ResultQueryKey,
  ResultQueryObserver,
  ResultSubscriptionObserver,
  RpcConstraintError,
  RuntimeCallOptions,
  RuntimeMiddleware,
  SubscriptionConnection,
  SubscriptionOptions,
  SubscriptionProcedureClientLike,
  SubscriptionClientError,
  SubscriptionClientInput,
  SubscriptionClientOutput,
  SubscriptionState,
  SubscriptionStateOf,
  EffectiveContractVersion,
  ErasedMiddlewareHandler,
} from "../query/runtime.js";
export { defineShell, layerShell, prefetchLayer } from "./shell.js";
export type * from "./shell.js";
export { boundaryShells } from "./boundary.js";
export type * from "./boundary.js";
export type {
  BoundaryShells,
  BoundaryShellsOptions,
  Connectivity,
  ConnectivityStatus,
} from "./boundary.js";
export type { AnyLayer, LayerShape } from "../layer.js";
export type { ErrorDefinitionMap, ErrorUnion } from "../error-map.js";
export type {
  AnyPublicErrorDefinition,
  AnyErrorDefinition,
  AnyPublicTaggedError,
  AnyTaggedError,
  EncodedTaggedError,
  ErrorDefinition,
  ErrorOf,
  ErrorPolicy,
  ErrorPolicyBase,
  ErrorSeverity,
  ErrorVisibility,
  RetryPolicy,
  TaggedError,
} from "../error.js";
export type {
  AffectsEntry,
  AnyProcedureTypes,
  PaginationManifest,
  ProcedureKind,
  ProcedureTypeCarrier,
  QueryAffectsTarget,
  WritesEntry,
} from "../procedure-types.js";
export type {
  PaginatedProcedureCapability,
  ProcedureCapability,
  UnaryProcedureCapability,
} from "../procedure-capability.js";
export type { ClaimRegistry } from "./claims.js";
export type { Err, Ok } from "../result.js";
export type {
  AnyWireCodec,
  CodecIssue,
  CodecShape,
  DecodeResult,
  EmptyObject,
  InputOf,
  OptionalShapeKeys,
  RequiredShapeKeys,
  ShapeInput,
  WireCodec,
  WireScalar,
  WireTypedArray,
  WireValue,
} from "../wire.js";
export { ClientStale, defectErrors, staleErrors, transportErrors } from "../framework-errors.js";

/** Zero-input procedures may omit the input argument entirely. */
export type QueryHookArgs<TProcedureClient extends QueryProcedureClientLike> =
  EmptyObject extends ProcedureClientInput<NoInfer<TProcedureClient>>
    ? [
        input?: ProcedureClientInput<NoInfer<TProcedureClient>>,
        options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>,
      ]
    : [
        input: ProcedureClientInput<NoInfer<TProcedureClient>>,
        options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>,
      ];

/** Zero-input subscriptions may omit the input argument entirely. */
export type SubscriptionHookArgs<TProcedureClient extends SubscriptionProcedureClientLike> =
  EmptyObject extends SubscriptionClientInput<NoInfer<TProcedureClient>>
    ? [
        input?: SubscriptionClientInput<NoInfer<TProcedureClient>>,
        options?: SubscriptionOptions<SubscriptionClientError<NoInfer<TProcedureClient>>>,
      ]
    : [
        input: SubscriptionClientInput<NoInfer<TProcedureClient>>,
        options?: SubscriptionOptions<SubscriptionClientError<NoInfer<TProcedureClient>>>,
      ];

function normalizeHookArgs<TInput, TOptions>(
  rest: readonly [input?: TInput, options?: TOptions],
  defaultOptions: TOptions,
): readonly [input: TInput, options: TOptions];
function normalizeHookArgs(
  rest: readonly [input?: unknown, options?: unknown],
  defaultOptions: unknown,
): readonly [input: unknown, options: unknown] {
  return [normalizeClientCallInput(rest), rest[1] ?? defaultOptions];
}
export type {
  AnyShell,
  AnyLayerShell,
  DefineShellOptions,
  SubtractClaimedErrors,
  ClaimedBy,
  ClaimedErrorsBy,
  Shell,
  ShellHoldings,
  ShellEffect,
  LayerShellOptions,
  LayerShellFactory,
  LayerShellClient,
  LayerShellMetadata,
  LayerShellProcedure,
  LayerShellProviderProps,
  TagsOf,
  ValueOf,
} from "./shell.js";

/**
 * Application-wide type registration, following TanStack's framework pattern.
 * Augment this interface once in an application to make `useResultClient()`
 * return its concrete client without a call-site type argument.
 */
export interface Register {}

export type RegisteredClient = Register extends { readonly client: infer TClient }
  ? TClient
  : unknown;

export type RegisteredProviderClient = RegisteredClient extends object ? RegisteredClient : object;

const RuntimeContext = createContext<QueryRuntime<unknown> | undefined>(undefined);

const claimRuntimeIds = new WeakMap<object, number>();
let nextClaimRuntimeId = 1;
const claimRuntimeId = (runtime: object): number => {
  const existing = claimRuntimeIds.get(runtime);
  if (existing !== undefined) return existing;
  const created = nextClaimRuntimeId++;
  claimRuntimeIds.set(runtime, created);
  return created;
};

const queryClaimId = (
  runtime: object,
  key: readonly [path: string, encodedInput: string],
): string => `query:${claimRuntimeId(runtime)}:${key[0].length}:${key[0]}:${key[1]}`;

const pendingOwnedRuntimeCleanup = new WeakMap<object, object>();

const useOwnedRuntimeCleanup = (runtime: QueryRuntime<object> | undefined): void => {
  useEffect(() => {
    if (runtime === undefined) return;
    // React Strict Mode immediately replays an effect's setup/cleanup pair.
    // Defer disposal one microtask so the replayed setup can cancel it, while
    // a real unmount or client replacement still clears exactly once.
    pendingOwnedRuntimeCleanup.delete(runtime);
    return () => {
      const token = {};
      pendingOwnedRuntimeCleanup.set(runtime, token);
      queueMicrotask(() => {
        if (pendingOwnedRuntimeCleanup.get(runtime) !== token) return;
        pendingOwnedRuntimeCleanup.delete(runtime);
        runtime.clear();
      });
    };
  }, [runtime]);
};

export type ResultRpcProviderProps<TClient extends object = object> = (
  | { readonly runtime: QueryRuntime<TClient>; readonly client?: undefined }
  | { readonly client: TClient; readonly runtime?: undefined }
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
const useProvidedRuntime = <TClient extends object>(
  props: ResultRpcProviderProps<TClient>,
): QueryRuntime<TClient> => {
  // Deliberately a ref, not useMemo. `createQueryRuntime` mounts a QueryClient,
  // which registers listeners on the global focus/online managers — so building
  // one is a side effect, not a computation. A useMemo factory is re-invoked on
  // Strict Mode's replayed render and may be dropped and recomputed at any
  // time, either of which strands a mounted client that cleanup can no longer
  // reach. Keyed on the client so a genuinely new client still gets a new
  // runtime, with the old one released by the cleanup effect below.
  const ownedRef = useRef<
    { readonly client: unknown; readonly runtime: QueryRuntime<TClient> } | undefined
  >(undefined);
  if (props.runtime === undefined && ownedRef.current?.client !== props.client) {
    ownedRef.current = {
      client: props.client,
      runtime: createQueryRuntime({ client: props.client }),
    };
  }
  const owned = props.runtime === undefined ? ownedRef.current?.runtime : undefined;
  useOwnedRuntimeCleanup(owned);
  const runtime = props.runtime ?? owned;
  if (runtime === undefined) throw new TypeError("ResultRpcProvider requires client or runtime");
  const hydrated = useRef<
    { readonly runtime: QueryRuntime<TClient>; readonly state: DehydratedQueryRuntime } | undefined
  >(undefined);
  if (
    props.hydrate !== undefined &&
    (hydrated.current?.runtime !== runtime || hydrated.current.state !== props.hydrate)
  ) {
    hydrated.current = { runtime, state: props.hydrate };
    try {
      runtime.hydrate(props.hydrate);
    } catch (cause) {
      warnHydrationSkew(cause);
    }
  }
  return runtime;
};

const ResultRpcProviderImpl = <TClient extends object>(props: ResultRpcProviderProps<TClient>) => {
  const runtime = useProvidedRuntime(props);
  return createElement(RuntimeContext.Provider, { value: runtime }, props.children);
};

/** Provider constrained to the globally registered client, when one exists. */
export const ResultRpcProvider = (
  props: ResultRpcProviderProps<RegisteredProviderClient>,
): ReactNode => ResultRpcProviderImpl(props);

const useRuntime = (): QueryRuntime<unknown> => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new TypeError("useResultQuery requires ResultRpcProvider");
  return runtime;
};

/** The enclosing provider's runtime, for imperative cache operations. */
export const useResultRuntime = (): QueryRuntime<RegisteredClient> =>
  useRuntime() as QueryRuntime<RegisteredClient>;

let hydrationSkewWarned = false;
const warnHydrationSkew = (cause: unknown) => {
  const processValue = Reflect.get(globalThis, "process");
  const env =
    processValue !== null && typeof processValue === "object"
      ? Reflect.get(processValue, "env")
      : undefined;
  const isProduction =
    env !== null && typeof env === "object" && Reflect.get(env, "NODE_ENV") === "production";
  if (isProduction || hydrationSkewWarned) return;
  hydrationSkewWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[result-rpc] skipped hydrating a dehydrated cache — its serializer/contract " +
      "version did not match this client (a server and client bundle briefly " +
      "skewed across a deploy). The client will fetch fresh instead of " +
      "rendering stale server data. Original error: " +
      (cause instanceof Error ? cause.message : String(cause)),
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
 * The client registered by the application and supplied to the enclosing
 * ResultRpcProvider.
 *
 *     declare module "result-rpc/react" {
 *       interface Register { client: AppClient }
 *     }
 *
 *     const client = useResultClient()
 */
export const useResultClient = (): RegisteredClient => useRuntime().client as RegisteredClient;

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
export const createResultRpcReact = <TClient extends object>(): Readonly<
  ResultRpcReact<TClient>
> => {
  const ScopedRuntimeContext = createContext<QueryRuntime<TClient> | undefined>(undefined);
  const useScopedRuntime = (): QueryRuntime<TClient> => {
    const runtime = useContext(ScopedRuntimeContext);
    if (!runtime) throw new TypeError("Scoped result-rpc hook requires its matching provider");
    return runtime;
  };
  const useClient = (): TClient => useScopedRuntime().client;
  const Provider = (props: ResultRpcProviderProps<TClient>): ReactNode => {
    const runtime = useProvidedRuntime(props);
    return createElement(
      RuntimeContext.Provider,
      { value: runtime },
      createElement(ScopedRuntimeContext.Provider, { value: runtime }, props.children),
    );
  };
  return Object.freeze({
    ResultRpcProvider: Provider,
    useResultClient: useClient,
    useResultRuntime: useScopedRuntime,
    layerShell: bindLayerShell(useClient),
  });
};

/** Builds the pause-holding breadcrumb notifier for a procedure, if a listener exists. */
const useClaimNotifier = (procedure: Function) => {
  const runtime = useRuntime();
  const identity = getClientIdentity(runtime.client);
  const listener = identity ? getClientEventListener(identity) : undefined;
  const path = getProcedureClientMetadata(procedure)?.path;
  return useMemo(() => {
    if (!listener || path === undefined) return undefined;
    return (
      entry: { readonly name: string; readonly effect: "pause" | "escalate" },
      error: AnyTaggedError,
    ) => {
      if (entry.effect !== "pause") return;
      listener({
        type: "claimed",
        path,
        tag: error._tag,
        owner: entry.name,
        effect: "pause",
      });
    };
  }, [listener, path]);
};

const useResultQueryResolvedWithClaim = <TProcedureClient extends QueryProcedureClientLike>(
  procedure: NarrowProcedureClient<TProcedureClient>,
  input: ProcedureClientInput<TProcedureClient>,
  options: QueryOptions<ProcedureClientError<TProcedureClient>>,
  suspenseLease?: SuspenseClaimLease | null,
): [
  QueryState<ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>>,
  AmbientClaim | undefined,
  () => Promise<void>,
] => {
  const runtime = useRuntime();
  const inputKey = runtime.cache.key(procedure, input)[1];
  // Options are read through a ref so inline objects (and inline retry
  // functions) never recreate the observer — the current render's values win.
  const queryOptionsRef = useRef(options);
  queryOptionsRef.current = options;
  const observer = useMemo(
    () => {
      const dynamicOptions: QueryOptions<ProcedureClientError<TProcedureClient>> = {
        ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
        ...(options.staleTime === undefined ? {} : { staleTime: options.staleTime }),
        ...(options.gcTime === undefined ? {} : { gcTime: options.gcTime }),
        get retry() {
          return queryOptionsRef.current.retry;
        },
      };
      return runtime.observe(procedure, input, dynamicOptions);
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- input identity is represented by inputKey
    [runtime, procedure, inputKey, options.enabled, options.staleTime, options.gcTime],
  );
  const observerRef = useRef(observer);
  observerRef.current = observer;
  const committedObserverRef = useRef<typeof observer | undefined>(undefined);
  const notifyClaim = useClaimNotifier(procedure);
  const [retryHeld] = useState(() => async () => {
    await observerRef.current.refetch();
  });
  const claimObserver = useClaimObserver(
    notifyClaim,
    retryHeld,
    queryClaimId(runtime, observer.key),
    suspenseLease,
  );
  const subscribe = useMemo(
    () => (listener: () => void) =>
      observer.subscribe(() => {
        const next = observer.getCurrentState();
        try {
          claimObserver.notify(next.state === "failure" ? next.error : undefined);
        } finally {
          listener();
        }
      }),
    [observer, claimObserver],
  );
  useEffect(() => {
    committedObserverRef.current = observer;
    return () => {
      if (committedObserverRef.current === observer) committedObserverRef.current = undefined;
      observer.destroy();
    };
  }, [observer]);
  const state = useSyncExternalStore(subscribe, observer.getCurrentState, observer.getCurrentState);
  // Ambient monitor: a failure claimed by any mounted shell never surfaces as
  // a terminal state, no matter which hook observed it.
  const claim = useAmbientClaim(claimObserver, state.state === "failure" ? state.error : undefined);
  const [settleForSuspense] = useState(() => async () => {
    const suspenseObserver = observerRef.current;
    try {
      // Settlement may populate the cache, but it never owns a shell claim.
      // React decides whether this suspended render is still relevant: a
      // still-mounted retry observes the cached failure and acquires through
      // `claim.wait()` below; abandoned or superseded work is never retried and
      // therefore cannot manufacture an ownerless holding or reaction.
      await suspenseObserver.refetch();
    } finally {
      // React discards hook memoization when an initial mount suspends. Such
      // an observer can never receive an effect cleanup; retire it once its
      // request/claim lifecycle has finished. A committed observer is retained
      // across update suspensions and stays live.
      if (committedObserverRef.current !== suspenseObserver) suspenseObserver.destroy();
    }
  });
  return [claim ? pauseQueryProjection(state) : state, claim, settleForSuspense];
};

const useResultQueryWithClaim = <TProcedureClient extends QueryProcedureClientLike>(
  procedure: NarrowProcedureClient<TProcedureClient>,
  ...rest: QueryHookArgs<TProcedureClient>
): [
  QueryState<ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>>,
  AmbientClaim | undefined,
] => {
  const [input, options] = normalizeHookArgs<
    ProcedureClientInput<TProcedureClient>,
    QueryOptions<ProcedureClientError<TProcedureClient>>
  >(rest, {});
  const [state, claim] = useResultQueryResolvedWithClaim(procedure, input, options, undefined);
  return [state, claim];
};

export const useResultQuery = <const TProcedureClient extends QueryProcedureClientLike>(
  procedure: NarrowProcedureClient<TProcedureClient>,
  ...rest: QueryHookArgs<TProcedureClient>
): QueryState<ProcedureClientOutput<TProcedureClient>, ProcedureClientError<TProcedureClient>> =>
  useResultQueryWithClaim(procedure, ...rest)[0];

/**
 * A claim-paused paginated projection: an enclosing shell owns the failure,
 * so this hook shows the previous rows (or pending) while the shell decides.
 * Same doctrine as `pauseQueryProjection` for unary queries.
 */
const pausePaginatedProjection = <TItem, E extends AnyTaggedError>(
  state: PaginatedState<TItem, E>,
): PaginatedState<TItem, never> => {
  const controls = {
    fetch: "paused" as const,
    failureCount: state.failureCount,
    isStale: state.isStale,
    updatedAt: state.updatedAt,
    pageCount: state.pageCount,
    hasNext: state.hasNext,
    fetchingNext: state.fetchingNext,
    refetch: state.refetch,
    fetchNext: state.fetchNext,
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
 * loaded window. Ambient shells claim failures exactly like `useResultQuery`;
 * use `Shell.usePaginatedQuery` when the return type should subtract them too.
 */
export const useResultPaginatedQuery = <
  const TProcedureClient extends PaginatedProcedureClientLike,
>(
  procedure: NarrowProcedureClient<TProcedureClient>,
  input: PaginatedClientListInput<NoInfer<TProcedureClient>>,
  options: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>> = {},
): PaginatedState<
  PaginatedClientItem<TProcedureClient>,
  ProcedureClientError<TProcedureClient>
> => {
  const runtime = useRuntime();
  const inputKey = serialize(input);
  if (!inputKey.ok) throw new TypeError("Paginated query input is not wire-serializable");
  const queryOptionsRef = useRef(options);
  queryOptionsRef.current = options;
  const observer = useMemo(
    () => {
      const dynamicOptions: QueryOptions<ProcedureClientError<TProcedureClient>> = {
        ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
        ...(options.staleTime === undefined ? {} : { staleTime: options.staleTime }),
        ...(options.gcTime === undefined ? {} : { gcTime: options.gcTime }),
        get retry() {
          return queryOptionsRef.current.retry;
        },
      };
      return runtime.observePaginated(procedure, input, dynamicOptions);
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- input identity is represented by inputKey
    [runtime, procedure, inputKey.value, options.enabled, options.staleTime, options.gcTime],
  );
  const observerRef = useRef(observer);
  observerRef.current = observer;
  const notifyClaim = useClaimNotifier(procedure);
  const [retryHeld] = useState(() => async () => {
    await observerRef.current.refetch();
  });
  const claimObserver = useClaimObserver(
    notifyClaim,
    retryHeld,
    queryClaimId(runtime, observer.key),
  );
  const subscribe = useMemo(
    () => (listener: () => void) =>
      observer.subscribe(() => {
        const next = observer.getCurrentState();
        try {
          claimObserver.notify(next.state === "failure" ? next.error : undefined);
        } finally {
          listener();
        }
      }),
    [observer, claimObserver],
  );
  useEffect(() => () => observer.destroy(), [observer]);
  const state = useSyncExternalStore(subscribe, observer.getCurrentState, observer.getCurrentState);
  const claim = useAmbientClaim(claimObserver, state.state === "failure" ? state.error : undefined);
  return claim ? pausePaginatedProjection(state) : state;
};

export type SuspenseQueryState<T, E extends AnyTaggedError> = Exclude<
  QueryState<T, E>,
  { readonly state: "pending" }
>;

export interface ResultSuspenseProps extends SuspenseProps {
  /** Replaces the claim lease when a conditional subtree changes identity. */
  readonly resetKey?: unknown;
}

/**
 * Suspense plus a committed lifecycle owner for shell-claimed failures.
 * A child that suspends before commit cannot install its own cleanup, so a
 * result-rpc suspense query which may be claimed belongs inside this boundary.
 */
export const ResultSuspense = ({ resetKey, children, ...props }: ResultSuspenseProps) => {
  const scope = useMemo(() => ({ resetKey, lease: createSuspenseClaimLease() }), [resetKey]);
  useEffect(() => {
    scope.lease.activate();
    return () => scope.lease.release();
  }, [scope]);
  return createElement(
    Suspense,
    props,
    createElement(SuspenseClaimLeaseContext.Provider, { value: scope.lease }, children),
  );
};

export const useResultSuspenseQuery = <const TProcedureClient extends QueryProcedureClientLike>(
  procedure: NarrowProcedureClient<TProcedureClient>,
  ...rest: QueryHookArgs<TProcedureClient>
): SuspenseQueryState<
  ProcedureClientOutput<TProcedureClient>,
  ProcedureClientError<TProcedureClient>
> => {
  const [input, options] = normalizeHookArgs<
    ProcedureClientInput<TProcedureClient>,
    QueryOptions<ProcedureClientError<TProcedureClient>>
  >(rest, {});
  const suspenseLease = useSuspenseClaimLease();
  const [state, claim, settle] = useResultQueryResolvedWithClaim(
    procedure,
    input,
    {
      ...options,
      enabled: true,
    },
    suspenseLease,
  );
  if (state.state === "pending") {
    // A claim-paused render waits on its exact acquisition. A request promise
    // only settles cache state; React retrying a still-relevant render is what
    // acquires ownership and lets the shell render its recovery affordance.
    throw claim ? claim.wait() : settle();
  }
  return state;
};

export const useResultMutation = <
  const TProcedureClient extends MutationProcedureClientLike,
  TContext = undefined,
>(
  procedure: NarrowProcedureClient<TProcedureClient>,
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
  const scope = useClaimScope();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  // The observer is created once per (runtime, procedure); every option is
  // read through a ref at use time. Inline options objects — the way React
  // codebases naturally write them — must never resubscribe or loop.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const definitions = useMemo(() => {
    const metadata = getProcedureClientMetadata(procedure);
    if (!metadata) throw new TypeError("Expected a registered result-rpc mutation client");
    return metadata.procedure._def.definitions;
  }, [procedure]);
  const observer = useMemo(() => {
    const dynamicOptions: MutationOptions<
      ProcedureClientInput<TProcedureClient>,
      ProcedureClientOutput<TProcedureClient>,
      ProcedureClientError<TProcedureClient>,
      TContext
    > = {
      get retry() {
        return (error: ProcedureClientError<TProcedureClient>, failureCount: number) => {
          const ownership = resolveClaimOwner(scopeRef.current, error);
          if (ownership.state !== "unclaimed") return false;
          return shouldRetryMutation(definitions, optionsRef.current.retry, failureCount, error);
        };
      },
      optimistic: (input, cache) => optionsRef.current.optimistic?.(input, cache),
      onSuccess: (value, input) => optionsRef.current.onSuccess?.(value, input),
      onFailure: (error, input, context, cache) => {
        const ownership = resolveClaimOwner(scopeRef.current, error);
        if (ownership.state !== "unclaimed") {
          return optionsRef.current.onCancel?.(input, context, cache);
        }
        return optionsRef.current.onFailure?.(error, input, context, cache);
      },
      onCancel: (input, context, cache) => optionsRef.current.onCancel?.(input, context, cache),
      onSettled: (result, input, context, cache) => {
        if (
          !result.isOk() &&
          resolveClaimOwner(scopeRef.current, result.error).state !== "unclaimed"
        ) {
          return undefined;
        }
        return optionsRef.current.onSettled?.(result, input, context, cache);
      },
    };
    return runtime.mutation(procedure, dynamicOptions);
  }, [runtime, procedure, definitions]);
  const observerRef = useRef(observer);
  observerRef.current = observer;
  const notifyClaim = useClaimNotifier(procedure);
  const [resetHeld] = useState(() => () => observerRef.current.reset());
  const claimObserver = useClaimObserver(notifyClaim, resetHeld);
  const subscribe = useMemo(
    () => (listener: () => void) =>
      observer.subscribe(() => {
        const next = observer.getCurrentState();
        try {
          claimObserver.notify(next.state === "failure" ? next.error : undefined);
        } finally {
          listener();
        }
      }),
    [observer, claimObserver],
  );
  useEffect(() => () => observer.destroy(), [observer]);
  const state = useSyncExternalStore(subscribe, observer.getCurrentState, observer.getCurrentState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [mutateAsync] = useState(() => async (input: ProcedureClientInput<TProcedureClient>) => {
    const result = await stateRef.current.mutateAsync(input);
    // An awaiting caller's continuation must not run on an outcome an enclosing
    // shell owns. Cancellation semantics, but a distinguishable signal: "you
    // cancelled" and "a shell owns this outcome" are different events.
    if (!result.isOk()) {
      const tag = result.error._tag;
      const owner = claimOwner(scopeRef.current, result.error);
      if (owner) throw claimed({ tag, owner: owner.name });
    }
    return result;
  });
  // Fire-and-forget, so there is no promise for a caller to leave unhandled.
  // A claimed failure is the shell's to react to and this state's to report;
  // rejecting here would make `onClick={() => m.mutateAsync(...)}` — the shape every
  // example uses — an unhandled rejection the moment anything claims.
  const [mutate] = useState(
    () => (input: ProcedureClientInput<TProcedureClient>) =>
      void mutateAsync(input).catch(() => undefined),
  );
  // On shell resume a held mutation RESETS instead of replaying: the failure
  // was already delivered to the caller as the claimed rejection, and firing
  // a side effect again is never the shell's call. Resetting ends the pause
  // arc so holdings (and the connection banner) drain on reconnect.
  const claim = useAmbientClaim(claimObserver, state.state === "failure" ? state.error : undefined);
  if (!claim) return { ...state, mutate, mutateAsync };
  return {
    ...(state.variables === undefined ? {} : { variables: state.variables }),
    mutate,
    mutateAsync,
    cancel: state.cancel,
    reset: state.reset,
    state: "idle" as const,
  };
};

export const useResultSubscription = <
  const TProcedureClient extends SubscriptionProcedureClientLike,
>(
  procedure: NarrowProcedureClient<TProcedureClient>,
  ...rest: SubscriptionHookArgs<TProcedureClient>
): SubscriptionState<
  SubscriptionClientOutput<TProcedureClient>,
  SubscriptionClientError<TProcedureClient>
> => {
  const [input, options] = normalizeHookArgs<
    SubscriptionClientInput<TProcedureClient>,
    SubscriptionOptions<SubscriptionClientError<TProcedureClient>>
  >(rest, {});
  const runtime = useRuntime();
  const encodedInput = serialize(input);
  if (!encodedInput.ok) throw new TypeError("Subscription input is not wire-serializable");
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const observer = useMemo(() => {
    const dynamicOptions: SubscriptionOptions<SubscriptionClientError<TProcedureClient>> = {
      get retry() {
        return optionsRef.current.retry;
      },
      get retryDelayMs() {
        return optionsRef.current.retryDelayMs;
      },
    };
    return runtime.subscription(procedure, input, dynamicOptions);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- encoded input represents input identity; callbacks are current through optionsRef
  }, [runtime, procedure, encodedInput.value]);
  const observerRef = useRef(observer);
  observerRef.current = observer;
  const notifyClaim = useClaimNotifier(procedure);
  const [retryHeld] = useState(() => () => observerRef.current.reconnect());
  const claimObserver = useClaimObserver(notifyClaim, retryHeld);
  const subscribe = useMemo(
    () => (listener: () => void) =>
      observer.subscribe(() => {
        const next = observer.getCurrentState();
        const nextFailure =
          next.result && next.result.status === "error" ? next.result.error : undefined;
        try {
          claimObserver.notify(nextFailure);
        } finally {
          listener();
        }
      }),
    [observer, claimObserver],
  );
  const state = useSyncExternalStore(subscribe, observer.getCurrentState, observer.getCurrentState);
  const failure = state.result && state.result.status === "error" ? state.result.error : undefined;
  const claim = useAmbientClaim(claimObserver, failure);
  if (!claim) return state;
  return { ...state, connection: "paused" as const, result: undefined };
};

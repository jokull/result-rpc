import {
  createContext,
  createElement,
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
import { cancelled } from "../client/transport.js";
import {
  pauseQueryProjection,
  scopeClaims,
  useAmbientClaim,
  useClaimScope,
  type AmbientClaim,
} from "./claims.js";
import type { ResultSubscription } from "../client/client.js";
import { serialize } from "../serializer.js";
import type {
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
export { defineShell, layerShell } from "./shell.js";

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
  HandledBy,
  Shell,
  ShellActiveState,
  ShellEffect,
  LayerShellOptions,
  LayerShellProviderProps,
  TagsOf,
  ValueOf,
} from "./shell.js";

const RuntimeContext = createContext<QueryRuntime | undefined>(undefined);

export type ResultRpcProviderProps =
  | { readonly runtime: QueryRuntime; readonly client?: undefined; readonly children?: ReactNode }
  | { readonly client: object; readonly runtime?: undefined; readonly children?: ReactNode };

/**
 * Provides the query runtime. Pass `client` to let the provider own a runtime
 * for the component's lifetime — the common case. Pass `runtime` when the app
 * needs the instance elsewhere (SSR prefetch, imperative cache access).
 */
export const ResultRpcProvider = (props: ResultRpcProviderProps) => {
  const [owned] = useState(() =>
    props.runtime ?? createQueryRuntime({ client: props.client }));
  return createElement(RuntimeContext.Provider, { value: props.runtime ?? owned }, props.children);
};

const useRuntime = (): QueryRuntime => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new TypeError("useResultQuery requires ResultRpcProvider");
  return runtime;
};

/**
 * The client the enclosing ResultRpcProvider was created with. Annotate the
 * type parameter with your app's client type:
 *
 *     const client = useResultClient<AppClient>()
 */
export const useResultClient = <TClient,>(): TClient => useRuntime().client as TClient;

export interface ResultRpcHydrationProps {
  readonly state: DehydratedQueryRuntime;
  readonly children?: ReactNode;
}

export const ResultRpcHydration = ({ state, children }: ResultRpcHydrationProps) => {
  const runtime = useRuntime();
  const hydrated = useRef<DehydratedQueryRuntime | undefined>(undefined);
  if (hydrated.current !== state) {
    runtime.hydrate(state);
    hydrated.current = state;
  }
  return children;
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
  const observer = useMemo(
    () => runtime.observe(procedure, input, options),
    [
      runtime,
      procedure,
      inputKey,
      options.enabled,
      options.staleTime,
      options.gcTime,
      options.retry,
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
  const claim = useAmbientClaim(state.state === "failure" ? state.result.error : undefined);
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
  const observer = useMemo(
    () => runtime.mutation(procedure, options),
    [
      runtime,
      procedure,
      options.retry,
      options.optimistic,
      options.onSuccess,
      options.onFailure,
      options.onCancel,
      options.onSettled,
    ],
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
    // owns; reject with the control sentinel, exactly like cancellation.
    if (!result.ok && scopeClaims(scopeRef.current, (result.error as AnyTaggedError)._tag)) {
      throw cancelled;
    }
    return result;
  });
  const claim = useAmbientClaim(
    state.state === "failure" ? (state.result.error as AnyTaggedError) : undefined,
  );
  if (!claim) return { ...state, mutate };
  return {
    ...(state.variables === undefined ? {} : { variables: state.variables }),
    mutate,
    cancel: state.cancel,
    reset: state.reset,
    state: "idle" as const,
    result: undefined,
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
  const claim = useAmbientClaim(failure);
  if (!claim) return state;
  return { ...state, connection: "paused" as const, result: undefined };
};

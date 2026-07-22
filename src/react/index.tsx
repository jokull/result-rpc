import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AnyTaggedError } from "../error.js";
import type { Result } from "../result.js";
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
type QueryProcedureClientLike = ProcedureClientLike & { readonly $kind: "query" };
type MutationProcedureClientLike = ProcedureClientLike & { readonly $kind: "mutation" };
type SubscriptionProcedureClientLike = ((
  input: any,
  options?: { readonly signal?: AbortSignal },
) => ResultSubscription<any, AnyTaggedError>) & { readonly $kind: "subscription" };

const RuntimeContext = createContext<QueryRuntime | undefined>(undefined);

export interface ResultRpcProviderProps {
  readonly runtime: QueryRuntime;
  readonly children?: ReactNode;
}

export const ResultRpcProvider = ({ runtime, children }: ResultRpcProviderProps) =>
  createElement(RuntimeContext.Provider, { value: runtime }, children);

const useRuntime = (): QueryRuntime => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new TypeError("useResultQuery requires ResultRpcProvider");
  return runtime;
};

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

export const useResultQuery = <TProcedureClient extends QueryProcedureClientLike>(
  procedure: TProcedureClient,
  input: ProcedureClientInput<TProcedureClient>,
  options: QueryOptions<ProcedureClientError<TProcedureClient>> = {},
): QueryState<
  ProcedureClientOutput<TProcedureClient>,
  ProcedureClientError<TProcedureClient>
> => {
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
  return useSyncExternalStore(
    observer.subscribe,
    observer.getCurrentState,
    observer.getCurrentState,
  );
};

export type SuspenseQueryState<T, E extends AnyTaggedError> = Exclude<
  QueryState<T, E>,
  { readonly state: "pending" }
>;

export const useResultSuspenseQuery = <TProcedureClient extends QueryProcedureClientLike>(
  procedure: TProcedureClient,
  input: ProcedureClientInput<TProcedureClient>,
  options: Omit<QueryOptions<ProcedureClientError<TProcedureClient>>, "enabled"> = {},
): SuspenseQueryState<
  ProcedureClientOutput<TProcedureClient>,
  ProcedureClientError<TProcedureClient>
> => {
  const state = useResultQuery(procedure, input, { ...options, enabled: true });
  if (state.state === "pending") {
    throw state.refetch().then(() => undefined);
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
  return useSyncExternalStore(
    observer.subscribe,
    observer.getCurrentState,
    observer.getCurrentState,
  );
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
  return useSyncExternalStore(
    observer.subscribe,
    observer.getCurrentState,
    observer.getCurrentState,
  );
};

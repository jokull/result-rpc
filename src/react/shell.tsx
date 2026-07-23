import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Context,
  type ReactNode,
} from "react";
import type { AnyTaggedError } from "../error.js";
import type { LayerShape } from "../layer.js";
import { ClaimScopeContext, type ClaimEntry } from "./claims.js";
import type { ErrorDefinitionMap, ErrorUnion } from "../server/contract.js";
import type {
  MutationOptions,
  MutationState,
  ProcedureClientError,
  ProcedureClientInput,
  ProcedureClientOutput,
  QueryOptions,
  QueryState,
  SubscriptionClientError,
  SubscriptionClientInput,
  SubscriptionClientOutput,
  SubscriptionOptions,
  SubscriptionState,
} from "../query/runtime.js";
import {
  useResultClient,
  useResultMutation,
  useResultQuery,
  useResultSubscription,
  useResultSuspenseQuery,
  type MutationProcedureClientLike,
  type QueryHookArgs,
  type QueryProcedureClientLike,
  type SubscriptionProcedureClientLike,
} from "./index.js";

/** Remove every union member whose `_tag` is claimed by an enclosing shell. */
export type ExcludeTags<TError, TTags extends string> = TError extends {
  readonly _tag: TTags;
}
  ? never
  : TError;

export type TagsOf<TDefinitions extends ErrorDefinitionMap> =
  TDefinitions[keyof TDefinitions]["tag"];

/**
 * `pause` keeps the operation in a non-terminal state and hands the error to the
 * shell. `escalate` throws the tagged value to the nearest React error boundary.
 */
export type ShellEffect = "pause" | "escalate";

export interface ShellActiveState<TError extends AnyTaggedError> {
  /** Most recently reported claimed error, if any operation is currently held. */
  readonly active: TError | undefined;
  /** Every distinct claimed error currently held by this shell. */
  readonly errors: readonly TError[];
  /** How many observers are currently held by this shell. */
  readonly affected: number;
}

interface ShellNode {
  readonly report: (id: string, error: AnyTaggedError) => void;
  readonly release: (id: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => ShellActiveState<AnyTaggedError>;
  readonly whenChanged: () => Promise<void>;
}

interface ShellMount {
  readonly node: ShellNode;
  readonly value: unknown;
}

interface ShellInternals {
  readonly name: string;
  readonly effect: ShellEffect;
  readonly ownTags: ReadonlySet<string>;
  readonly context: Context<ShellMount | undefined>;
  /** Innermost first: `[self, parent, grandparent, ...]`. */
  readonly chain: readonly ShellInternals[];
}

export interface Shell<
  THandled extends string = string,
  TProps = Record<never, never>,
  TValue = void,
  TOwn extends AnyTaggedError = AnyTaggedError,
> {
  readonly $shell: true;
  readonly name: string;
  readonly effect: ShellEffect;
  /** Tags this layer claims. */
  readonly ownTags: readonly string[];
  /** Tags this layer and every enclosing layer claim. */
  readonly handledTags: readonly string[];
  readonly Provider: (props: TProps & { readonly children?: ReactNode }) => ReactNode;

  /** The value this layer guarantees. Throws if the layer is not mounted. */
  use(): TValue;
  /** Aggregate view of what this layer is currently holding. */
  useActive(): ShellActiveState<TOwn>;

  useQuery<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
    ...rest: QueryHookArgs<TProcedureClient>
  ): QueryState<
    ProcedureClientOutput<TProcedureClient>,
    ExcludeTags<ProcedureClientError<TProcedureClient>, THandled>
  >;

  useSuspenseQuery<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
    ...rest: QueryHookArgs<TProcedureClient>
  ): Exclude<
    QueryState<
      ProcedureClientOutput<TProcedureClient>,
      ExcludeTags<ProcedureClientError<TProcedureClient>, THandled>
    >,
    { readonly state: "pending" }
  >;

  useMutation<TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(
    procedure: TProcedureClient,
    options?: MutationOptions<
      ProcedureClientInput<TProcedureClient>,
      ProcedureClientOutput<TProcedureClient>,
      ExcludeTags<ProcedureClientError<TProcedureClient>, THandled>,
      TContext
    >,
  ): MutationState<
    ProcedureClientInput<TProcedureClient>,
    ProcedureClientOutput<TProcedureClient>,
    ExcludeTags<ProcedureClientError<TProcedureClient>, THandled>
  >;

  useSubscription<TProcedureClient extends SubscriptionProcedureClientLike>(
    procedure: TProcedureClient,
    input: SubscriptionClientInput<TProcedureClient>,
    options?: SubscriptionOptions<SubscriptionClientError<TProcedureClient>>,
  ): SubscriptionState<
    SubscriptionClientOutput<TProcedureClient>,
    ExcludeTags<SubscriptionClientError<TProcedureClient>, THandled>
  >;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyShell = Shell<any, any, any, any>;

export type HandledBy<TShell> = TShell extends Shell<infer THandled, any, any, any>
  ? THandled
  : never;

export type ValueOf<TShell> = TShell extends Shell<any, any, infer TValue, any>
  ? TValue
  : never;

export interface DefineShellOptions<
  TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined,
  TProps,
  TValue,
> {
  /** Used in mount diagnostics and devtools. */
  readonly name: string;
  /** The enclosing layer. Omit for the outermost layer. */
  readonly from?: TParent;
  /** The error definitions this layer claims. Pass the same map given to `.errors()`. */
  readonly handle: TDefinitions;
  /** Defaults to `"pause"`. */
  readonly effect?: ShellEffect;
  /** Runs once per newly claimed error. May fire many times for one logical event. */
  readonly onError?: (error: ErrorUnion<TDefinitions>, value: TValue) => void;
  /**
   * Builds the value this layer guarantees from its Provider props. The returned
   * value should be referentially stable across renders with equal props.
   */
  readonly provide?: (props: TProps) => TValue;
}

const emptyActive: ShellActiveState<AnyTaggedError> = Object.freeze({
  active: undefined,
  errors: Object.freeze([]),
  affected: 0,
});

const internals = new WeakMap<AnyShell, ShellInternals>();

const internalsOf = (shell: AnyShell): ShellInternals => {
  const found = internals.get(shell);
  if (!found) throw new TypeError("Expected a result-rpc shell");
  return found;
};

const createNode = (
  onError: ((error: never, value: unknown) => void) | undefined,
  valueRef: { current: unknown },
): ShellNode => {
  const entries = new Map<string, AnyTaggedError>();
  const listeners = new Set<() => void>();
  let changed: Array<() => void> = [];
  let snapshot = emptyActive;
  const recompute = () => {
    const errors = [...entries.values()];
    snapshot = {
      active: errors[errors.length - 1],
      errors,
      affected: errors.length,
    };
    for (const listener of listeners) listener();
    const pending = changed;
    changed = [];
    for (const resolve of pending) resolve();
  };
  return {
    report: (id, error) => {
      if (entries.get(id) === error) return;
      entries.set(id, error);
      recompute();
      onError?.(error as never, valueRef.current);
    },
    release: (id) => {
      if (entries.delete(id)) recompute();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => snapshot,
    whenChanged: () =>
      new Promise<void>((resolve) => {
        changed.push(resolve);
      }),
  };
};

const missingParentContext = createContext<ShellMount | undefined>(undefined);

export const defineShell = <
  const TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined = undefined,
  TProps = Record<never, never>,
  TValue = void,
>(
  options: DefineShellOptions<TDefinitions, TParent, TProps, TValue>,
): Shell<
  | TagsOf<TDefinitions>
  | (TParent extends AnyShell ? HandledBy<TParent> : never),
  TProps,
  TValue,
  ErrorUnion<TDefinitions>
> => {
  const parent = options.from as AnyShell | undefined;
  const parentInternals = parent ? internalsOf(parent) : undefined;
  const ownTags = new Set(Object.values(options.handle).map((definition) => definition.tag));
  if (ownTags.size === 0 && options.provide === undefined) {
    throw new TypeError(
      `Shell ${options.name} claims no errors and provides no value`,
    );
  }
  for (const enclosing of parentInternals?.chain ?? []) {
    for (const tag of ownTags) {
      if (enclosing.ownTags.has(tag)) {
        throw new TypeError(
          `Shell ${options.name} claims ${tag}, already claimed by ${enclosing.name}`,
        );
      }
    }
  }

  const context = createContext<ShellMount | undefined>(undefined);
  const effect: ShellEffect = options.effect ?? "pause";
  const self: ShellInternals = {
    name: options.name,
    effect,
    ownTags,
    context,
    chain: [],
  };
  (self as { chain: readonly ShellInternals[] }).chain = [
    self,
    ...(parentInternals?.chain ?? []),
  ];

  const parentContext = parentInternals?.context ?? missingParentContext;

  const Provider = (props: TProps & { readonly children?: ReactNode }): ReactNode => {
    const enclosing = useContext(parentContext);
    if (parentInternals && !enclosing) {
      throw new TypeError(
        `Shell ${options.name} must be mounted inside ${parentInternals.name}`,
      );
    }
    const value = options.provide ? options.provide(props) : (undefined as TValue);
    const valueRef = useRef<unknown>(value);
    valueRef.current = value;
    const [node] = useState(() => createNode(
        options.onError as ((error: never, value: unknown) => void) | undefined,
        valueRef,
      ));
    const mount = useMemo<ShellMount>(() => ({ node, value }), [node, value]);
    const parentScope = useContext(ClaimScopeContext);
    const entry = useMemo<ClaimEntry>(() => ({
      name: options.name,
      effect,
      tags: ownTags,
      report: node.report,
      release: node.release,
      whenChanged: node.whenChanged,
    }), [node]);
    const scope = useMemo(() => [...parentScope, entry], [parentScope, entry]);
    return createElement(
      context.Provider,
      { value: mount },
      createElement(ClaimScopeContext.Provider, { value: scope }, props.children),
    );
  };

  const useMount = (): ShellMount => {
    const mount = useContext(context);
    if (!mount) throw new TypeError(`Shell ${options.name} is not mounted`);
    return mount;
  };

  const shell = {
    $shell: true as const,
    name: options.name,
    effect,
    ownTags: [...ownTags],
    handledTags: self.chain.flatMap((layer) => [...layer.ownTags]),
    Provider,
    use: () => useMount().value as TValue,
    useActive: () => {
      const { node } = useMount();
      return useSyncExternalStore(node.subscribe, node.snapshot, node.snapshot);
    },
    // Absorption is ambient (any hook under the providers); the shell hooks add
    // the type subtraction and an eager proof that the whole chain is mounted,
    // so the narrowed union can never outrun its owners.
    useQuery: (procedure: any, input: any, queryOptions?: any) => {
      useAssertChainMounted(self);
      return useResultQuery(procedure, ...([input, queryOptions] as [never, never]));
    },
    useSuspenseQuery: (procedure: any, input: any, queryOptions?: any) => {
      useAssertChainMounted(self);
      return useResultSuspenseQuery(procedure, ...([input, queryOptions] as [never, never]));
    },
    useMutation: (procedure: any, mutationOptions?: any) => {
      useAssertChainMounted(self);
      return useResultMutation(procedure, mutationOptions);
    },
    useSubscription: (procedure: any, input: any, subscriptionOptions?: any) => {
      useAssertChainMounted(self);
      return useResultSubscription(procedure, input, subscriptionOptions);
    },
  } as unknown as Shell<
    | TagsOf<TDefinitions>
    | (TParent extends AnyShell ? HandledBy<TParent> : never),
    TProps,
    TValue,
    ErrorUnion<TDefinitions>
  >;

  internals.set(shell, self);
  return shell;
};

/**
 * Eagerly proves the shell's whole chain is mounted. The type subtraction on a
 * shell hook is only honest if every claimed tag has a live owner above.
 */
const useAssertChainMounted = (shell: ShellInternals): void => {
  // The chain is fixed at definition time, so this hook count is stable per call site.
  for (const layer of shell.chain) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const mount = useContext(layer.context);
    if (!mount) throw new TypeError(`Shell ${layer.name} is not mounted`);
  }
};

// --- Layer shells ----------------------------------------------------------

export interface LayerShellOptions<
  TParent extends AnyShell | undefined,
  TProcedureClient extends QueryProcedureClientLike,
  TValue,
> {
  /** The enclosing shell layer. Omit for the outermost layer. */
  readonly from?: TParent;
  /**
   * The client procedure for the layer's context procedure (`layer.contract`),
   * either directly or as a selector from the app's client — the selector form
   * lets shells be defined at module level, before any client exists; it is
   * resolved through the enclosing ResultRpcProvider at render time.
   */
  readonly procedure: TProcedureClient | ((client: never) => TProcedureClient);
  /**
   * Fires when the layer cannot be established — a load failure the enclosing
   * layers did not claim — and when an operation inside the layer fails with
   * one of the layer's own tags. Must be idempotent.
   */
  readonly onError?: (
    error: TParent extends AnyShell
      ? ExcludeTags<ProcedureClientError<TProcedureClient>, HandledBy<TParent>>
      : ProcedureClientError<TProcedureClient>,
    value: TValue | undefined,
  ) => void;
}

export interface LayerShellProviderProps {
  readonly children?: ReactNode;
  /** Rendered while the layer value loads and after an unrecoverable load failure. */
  readonly fallback?: ReactNode;
}

/**
 * Derives the React sibling of a shared layer declaration: a shell that loads
 * the guaranteed value through the layer's context procedure, provides it to
 * the subtree, and claims the layer's error union.
 *
 * The load itself runs under the enclosing shell (`from:`), so ambient and
 * defect failures during load are owned by the layers that already claim them;
 * only the layer's own errors reach `onError`.
 */
export const layerShell = <
  TKey extends string,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
  TProcedureClient extends QueryProcedureClientLike,
  TParent extends AnyShell | undefined = undefined,
>(
  layer: LayerShape<TKey, TValue, TDefinitions>,
  options: LayerShellOptions<TParent, TProcedureClient, TValue>,
): Shell<
  | TagsOf<TDefinitions>
  | (TParent extends AnyShell ? HandledBy<TParent> : never),
  LayerShellProviderProps,
  TValue,
  ErrorUnion<TDefinitions>
> => {
  const valueHolder: { current: TValue | undefined } = { current: undefined };
  const inner = defineShell({
    name: layer.name,
    ...(options.from === undefined ? {} : { from: options.from }),
    handle: layer.errors,
    effect: "pause",
    ...(options.onError === undefined
      ? {}
      : {
        onError: (error: ErrorUnion<TDefinitions>) =>
          (options.onError as (error: AnyTaggedError, value: TValue | undefined) => void)(
            error,
            valueHolder.current,
          ),
      }),
    provide: (props: { readonly value: TValue }) => props.value,
  });
  const parent = options.from as AnyShell | undefined;
  const resolveProcedure = (client: unknown): TProcedureClient => {
    // Client procedures carry $kind; a bare selector function does not.
    const candidate = options.procedure as unknown as ((client: unknown) => TProcedureClient) & {
      readonly $kind?: unknown;
    };
    return candidate.$kind === undefined
      ? candidate(client)
      : (options.procedure as TProcedureClient);
  };
  // Chosen once at definition time, so the wrapped Provider's hook order is stable.
  const useLoad = parent
    ? (): QueryState<TValue, AnyTaggedError> =>
        parent.useQuery(
          resolveProcedure(useResultClient()),
          {} as ProcedureClientInput<TProcedureClient>,
        ) as unknown as QueryState<TValue, AnyTaggedError>
    : (): QueryState<TValue, AnyTaggedError> =>
        useResultQuery(
          resolveProcedure(useResultClient()),
          {} as ProcedureClientInput<TProcedureClient>,
        ) as unknown as QueryState<TValue, AnyTaggedError>;

  const Provider = ({ children, fallback }: LayerShellProviderProps): ReactNode => {
    const load = useLoad();
    const value = load.state === "success" ? load.result.value : undefined;
    valueHolder.current = value;
    const failure = load.state === "failure" ? load.result.error : undefined;
    const onError = options.onError as
      | ((error: AnyTaggedError, value: TValue | undefined) => void)
      | undefined;
    useEffect(() => {
      if (failure) onError?.(failure, undefined);
    }, [failure, onError]);
    if (load.state !== "success") return fallback ?? null;
    return createElement(
      inner.Provider as (props: {
        readonly value: TValue;
        readonly children?: ReactNode;
      }) => ReactNode,
      { value: load.result.value },
      children,
    );
  };

  const shell = { ...inner, Provider } as unknown as Shell<
    | TagsOf<TDefinitions>
    | (TParent extends AnyShell ? HandledBy<TParent> : never),
    LayerShellProviderProps,
    TValue,
    ErrorUnion<TDefinitions>
  >;
  // The wrapped shell shares the inner shell's identity in the chain registry so
  // child shells can use it as `from:` and hooks resolve the same context.
  internals.set(shell, internalsOf(inner as AnyShell));
  layerResolvers.set(shell, resolveProcedure as (client: unknown) => QueryProcedureClientLike);
  return shell;
};

const layerResolvers = new WeakMap<AnyShell, (client: unknown) => QueryProcedureClientLike>();

/**
 * Internal: the context-procedure resolver of a layer-derived shell, used by
 * router integrations to derive prefetching loaders. Undefined for plain shells.
 */
export const getLayerProcedureResolver = (
  shell: AnyShell,
): ((client: unknown) => QueryProcedureClientLike) | undefined => layerResolvers.get(shell);

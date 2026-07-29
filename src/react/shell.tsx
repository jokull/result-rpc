"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Context,
  type ReactNode,
} from "react";
import { isTaggedError, type AnyErrorDefinition, type AnyTaggedError } from "../error.js";
import type { EmptyObject } from "../wire.js";
import type { RpcConstraintError } from "../type-diagnostics.js";
import type { LayerShape } from "../layer.js";
import { ClaimScopeContext, type ClaimEntry, type ClaimRegistry } from "./claims.js";
import type { ErrorDefinitionMap, ErrorUnion } from "../server/contract.js";
import type {
  MutationOptions,
  MutationState,
  PaginatedClientItem,
  PaginatedClientListInput,
  PaginatedProcedureClientLike,
  PaginatedState,
  ProcedureClientError,
  ProcedureClientInput,
  ProcedureClientOutput,
  ProcedureClientResult,
  QueryOptions,
  QueryRuntime,
  QueryState,
  SubscriptionClientError,
  SubscriptionClientOutput,
  SubscriptionState,
} from "../query/runtime.js";
import {
  useResultClient,
  useResultMutation,
  useResultPaginatedQuery,
  useResultQuery,
  useResultSubscription,
  useResultSuspenseQuery,
  type MutationProcedureClientLike,
  type QueryHookArgs,
  type QueryProcedureClientLike,
  type SubscriptionHookArgs,
  type SubscriptionProcedureClientLike,
} from "./index.js";

type ErrorSignature<TError> = TError extends {
  readonly _tag: infer TTag;
  readonly data: infer TData;
  readonly visibility: infer TVisibility;
}
  ? readonly [tag: TTag, data: TData, visibility: TVisibility]
  : never;

type IsTypeEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
      ? true
      : false
    : false;

type HasExactClaim<TError, TClaimedError> = TClaimedError extends AnyTaggedError
  ? IsTypeEqual<ErrorSignature<TError>, ErrorSignature<TClaimedError>> extends true
    ? true
    : never
  : never;

/**
 * Removes only procedure-error members whose complete public signature is
 * owned by a shell. The distributive outer conditional preserves every other
 * member verbatim; a shared tag alone is deliberately insufficient.
 */
export type SubtractClaimedErrors<
  TError,
  TClaimedError extends AnyTaggedError,
> = TError extends AnyTaggedError
  ? true extends HasExactClaim<TError, TClaimedError>
    ? never
    : TError
  : TError;

export type TagsOf<TDefinitions extends ErrorDefinitionMap> =
  TDefinitions[keyof TDefinitions]["tag"];

/**
 * `pause` keeps the operation in a non-terminal state and hands the error to the
 * shell. `escalate` throws the tagged value to the nearest React error boundary.
 */
export type ShellEffect = "pause" | "escalate";

export interface ShellHoldings<TError extends AnyTaggedError> {
  /** Most recently reported claimed error, if any operation is currently held. */
  readonly latest: TError | undefined;
  /** Every distinct claimed error currently held by this shell. */
  readonly errors: readonly TError[];
  /** How many observers are currently held by this shell. */
  readonly affected: number;
  /**
   * Retries every operation this shell is holding — the end of the pause arc:
   * claim, hold, fix the condition (re-authenticate, reconnect), resume.
   * Queries refetch and subscriptions reconnect; held mutations reset to
   * idle — their failure was already delivered to the caller as the claimed
   * rejection, and replaying a side effect is never the shell's call to make.
   */
  readonly resume: () => void;
}

export interface ShellErrorRegistry<TError extends AnyTaggedError> extends ClaimRegistry<TError> {}

type ShellClaimedErrors<
  TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined,
> = ErrorUnion<TDefinitions> | (TParent extends AnyShell ? ClaimedErrorsBy<TParent> : never);

/**
 * The non-generic runtime identity shared by every shell. This is the
 * existential constraint used while composing shell chains; importantly, it
 * does not instantiate the generic hook surface with `any`.
 */
export interface AnyShell {
  readonly $shell: true;
  readonly name: string;
  readonly effect: ShellEffect;
  readonly claims: ErrorDefinitionMap;
  readonly parent: AnyShell | undefined;
  readonly ownTags: readonly string[];
  readonly claimedTags: readonly string[];
  // Provider props are deliberately erased only for shell-agnostic adapters.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly Provider: (props: any) => ReactNode;
  use(): unknown;
  useHeld(): ShellHoldings<AnyTaggedError>;
}

interface ShellNode {
  readonly report: (id: string, error: AnyTaggedError, retry?: () => void) => void;
  readonly release: (id: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => ShellHoldings<AnyTaggedError>;
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
  readonly registry: ShellErrorRegistry<AnyTaggedError>;
  readonly context: Context<ShellMount | undefined>;
  /** Innermost first: `[self, parent, grandparent, ...]`. */
  readonly chain: readonly ShellInternals[];
}

export interface Shell<
  TDefinitions extends ErrorDefinitionMap = ErrorDefinitionMap,
  TParent extends AnyShell | undefined = AnyShell | undefined,
  TProps = Record<never, never>,
  TValue = unknown,
> extends AnyShell {
  readonly $shell: true;
  readonly name: string;
  readonly effect: ShellEffect;
  /** Runtime guard and associated type for every error this shell chain claims. */
  readonly $errors: ShellErrorRegistry<ShellClaimedErrors<TDefinitions, TParent>>;
  /** The exact definitions owned by this shell. */
  readonly claims: TDefinitions;
  /** The exact enclosing shell, retained for runtime and type-level composition. */
  readonly parent: TParent;
  /** Tags this shell claims. */
  readonly ownTags: readonly TagsOf<TDefinitions>[];
  /** Tags this shell and every enclosing shell claim. */
  readonly claimedTags: readonly (
    | TagsOf<TDefinitions>
    | (TParent extends AnyShell ? ClaimedBy<TParent> : never)
  )[];
  readonly Provider: (props: TProps & { readonly children?: ReactNode }) => ReactNode;

  /** The value this shell guarantees. Throws if the shell is not mounted. */
  use(): TValue;
  /** Aggregate view of what this shell is currently holding. */
  useHeld(): ShellHoldings<ErrorUnion<TDefinitions>>;

  useQuery<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
    ...rest: QueryHookArgs<TProcedureClient>
  ): QueryState<
    ProcedureClientOutput<TProcedureClient>,
    SubtractClaimedErrors<
      ProcedureClientError<TProcedureClient>,
      ShellClaimedErrors<TDefinitions, TParent>
    >
  >;

  useSuspenseQuery<TProcedureClient extends QueryProcedureClientLike>(
    procedure: TProcedureClient,
    ...rest: QueryHookArgs<TProcedureClient>
  ): Exclude<
    QueryState<
      ProcedureClientOutput<TProcedureClient>,
      SubtractClaimedErrors<
        ProcedureClientError<TProcedureClient>,
        ShellClaimedErrors<TDefinitions, TParent>
      >
    >,
    { readonly state: "pending" }
  >;

  usePaginatedQuery<TProcedureClient extends PaginatedProcedureClientLike>(
    procedure: TProcedureClient,
    input: PaginatedClientListInput<TProcedureClient>,
    options?: QueryOptions<ProcedureClientError<TProcedureClient>>,
  ): PaginatedState<
    PaginatedClientItem<TProcedureClient>,
    SubtractClaimedErrors<
      ProcedureClientError<TProcedureClient>,
      ShellClaimedErrors<TDefinitions, TParent>
    >
  >;

  useMutation<TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(
    procedure: TProcedureClient,
    options?: MutationOptions<
      ProcedureClientInput<TProcedureClient>,
      ProcedureClientOutput<TProcedureClient>,
      ProcedureClientError<TProcedureClient>,
      TContext
    >,
  ): MutationState<
    ProcedureClientInput<TProcedureClient>,
    ProcedureClientOutput<TProcedureClient>,
    SubtractClaimedErrors<
      ProcedureClientError<TProcedureClient>,
      ShellClaimedErrors<TDefinitions, TParent>
    >
  >;

  useSubscription<TProcedureClient extends SubscriptionProcedureClientLike>(
    procedure: TProcedureClient,
    ...rest: SubscriptionHookArgs<TProcedureClient>
  ): SubscriptionState<
    SubscriptionClientOutput<TProcedureClient>,
    SubtractClaimedErrors<
      SubscriptionClientError<TProcedureClient>,
      ShellClaimedErrors<TDefinitions, TParent>
    >
  >;
}

export type ClaimedBy<TShell> = TShell extends {
  readonly claims: infer TDefinitions extends ErrorDefinitionMap;
  readonly parent: infer TParent;
}
  ? TagsOf<TDefinitions> | ClaimedBy<TParent>
  : never;

export type ClaimedErrorsBy<TShell> = TShell extends {
  readonly claims: infer TDefinitions extends ErrorDefinitionMap;
  readonly parent: infer TParent;
}
  ? ErrorUnion<TDefinitions> | ClaimedErrorsBy<TParent>
  : never;

export type ValueOf<TShell> = TShell extends { use(): infer TValue } ? TValue : never;

export interface DefineShellOptions<
  TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined,
  TProps,
  TValue,
> {
  /** Used in mount diagnostics and devtools. */
  readonly name: string;
  /** The enclosing shell. Omit for the outermost shell. */
  readonly from?: TParent;
  /** The error definitions this shell claims. Pass the same map given to `.errors()`. */
  readonly claims: TDefinitions;
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

const internals = new WeakMap<AnyShell, ShellInternals>();

const internalsOf = (shell: AnyShell): ShellInternals => {
  const found = internals.get(shell);
  if (!found) throw new TypeError("Expected a result-rpc shell");
  return found;
};

const createNode = <TError extends AnyTaggedError, TValue>(
  name: string,
  registry: ShellErrorRegistry<TError>,
  onError: ((error: TError, value: TValue) => void) | undefined,
  valueRef: { current: TValue },
): ShellNode => {
  const entries = new Map<
    string,
    { readonly error: AnyTaggedError; readonly retry?: () => void }
  >();
  const listeners = new Set<() => void>();
  let changed: Array<() => void> = [];
  const retryAll = () => {
    for (const holding of [...entries.values()]) holding.retry?.();
  };
  let snapshot: ShellHoldings<AnyTaggedError> = Object.freeze({
    latest: undefined,
    errors: Object.freeze([]),
    affected: 0,
    resume: retryAll,
  });
  const recompute = () => {
    const errors = [...entries.values()].map((holding) => holding.error);
    snapshot = {
      latest: errors[errors.length - 1],
      errors,
      affected: errors.length,
      resume: retryAll,
    };
    for (const listener of listeners) listener();
    const pending = changed;
    changed = [];
    for (const resolve of pending) resolve();
  };
  return {
    report: (id, error, retry) => {
      if (!registry.is(error)) {
        throw new TypeError(
          `Shell ${name} received ${error._tag} from a different error definition`,
        );
      }
      if (entries.get(id)?.error === error) return;
      entries.set(id, retry === undefined ? { error } : { error, retry });
      recompute();
      onError?.(error, valueRef.current);
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

const createShellErrorRegistry = <TDefinitions extends ErrorDefinitionMap>(
  name: string,
  claims: TDefinitions,
): ShellErrorRegistry<ErrorUnion<TDefinitions>> => {
  const definitions = new Map<string, AnyErrorDefinition>();
  for (const definition of Object.values(claims)) {
    const existing = definitions.get(definition.tag);
    if (existing && existing !== definition) {
      throw new TypeError(`Shell ${name} declares two different definitions for ${definition.tag}`);
    }
    definitions.set(definition.tag, definition);
  }
  return Object.freeze({
    definitions,
    is: (value: unknown): value is ErrorUnion<TDefinitions> =>
      isTaggedError(value) && definitions.get(value._tag)?.is(value) === true,
  });
};

const missingParentContext = createContext<ShellMount | undefined>(undefined);

export const defineShell = <
  const TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined = undefined,
  TProps = Record<never, never>,
  TValue = void,
>(
  options: DefineShellOptions<TDefinitions, TParent, TProps, TValue>,
): Shell<TDefinitions, TParent, TProps, TValue> => {
  const parent = options.from as AnyShell | undefined;
  const parentInternals = parent ? internalsOf(parent) : undefined;
  const ownRegistry = createShellErrorRegistry(options.name, options.claims);
  const ownTags = new Set(ownRegistry.definitions.keys());
  if (ownTags.size === 0 && options.provide === undefined) {
    throw new TypeError(`Shell ${options.name} claims no errors and provides no value`);
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
    registry: ownRegistry,
    context,
    chain: [],
  };
  (self as { chain: readonly ShellInternals[] }).chain = [self, ...(parentInternals?.chain ?? [])];

  const parentContext = parentInternals?.context ?? missingParentContext;

  const Provider = (props: TProps & { readonly children?: ReactNode }): ReactNode => {
    const enclosing = useContext(parentContext);
    if (parentInternals && !enclosing) {
      throw new TypeError(`Shell ${options.name} must be mounted inside ${parentInternals.name}`);
    }
    const value = options.provide ? options.provide(props) : (undefined as TValue);
    const valueRef = useRef<TValue>(value);
    valueRef.current = value;
    const [node] = useState(() => createNode(options.name, ownRegistry, options.onError, valueRef));
    const mount = useMemo<ShellMount>(() => ({ node, value }), [node, value]);
    const parentScope = useContext(ClaimScopeContext);
    const entry = useMemo<ClaimEntry>(
      () => ({
        name: options.name,
        effect,
        registry: ownRegistry,
        report: node.report,
        release: node.release,
        whenChanged: node.whenChanged,
      }),
      [node],
    );
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

  const claimedDefinitions = new Map<string, AnyErrorDefinition>();
  for (const layer of self.chain) {
    for (const [tag, definition] of layer.registry.definitions) {
      claimedDefinitions.set(tag, definition);
    }
  }

  const shell = {
    $shell: true as const,
    $errors: {
      definitions: claimedDefinitions,
      is: (value: unknown): value is AnyTaggedError =>
        self.chain.some((layer) => layer.registry.is(value)),
    },
    name: options.name,
    effect,
    claims: options.claims,
    parent: options.from,
    ownTags: [...ownTags],
    claimedTags: self.chain.flatMap((layer) => [...layer.ownTags]),
    Provider,
    use: () => useMount().value as TValue,
    useHeld: () => {
      const { node } = useMount();
      return useSyncExternalStore(node.subscribe, node.snapshot, node.snapshot);
    },
    // Absorption is ambient (any hook under the providers); the shell hooks add
    // the type subtraction and an eager proof that the whole chain is mounted,
    // so the narrowed union can never outrun its owners.
    useQuery: (procedure: any, ...rest: any[]) => {
      useAssertChainMounted(self);
      return useResultQuery(procedure, ...rest);
    },
    useSuspenseQuery: (procedure: any, ...rest: any[]) => {
      useAssertChainMounted(self);
      return useResultSuspenseQuery(procedure, ...rest);
    },
    usePaginatedQuery: (procedure: any, input: any, queryOptions?: any) => {
      useAssertChainMounted(self);
      return useResultPaginatedQuery(
        procedure as PaginatedProcedureClientLike,
        input as never,
        queryOptions,
      );
    },
    useMutation: (procedure: any, mutationOptions?: any) => {
      useAssertChainMounted(self);
      return useResultMutation(procedure, mutationOptions);
    },
    useSubscription: (procedure: any, ...rest: any[]) => {
      useAssertChainMounted(self);
      return useResultSubscription(procedure, ...rest);
    },
  } as unknown as Shell<TDefinitions, TParent, TProps, TValue>;

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

type Exact<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false;

type LayerProcedureCompatibility<
  TProcedureClient extends QueryProcedureClientLike,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
> = (Exact<ProcedureClientOutput<TProcedureClient>, TValue> extends true
  ? unknown
  : RpcConstraintError<
      "layer-procedure-output-does-not-match-layer-value",
      { readonly expected: TValue; readonly actual: ProcedureClientOutput<TProcedureClient> }
    >) &
  (EmptyObject extends ProcedureClientInput<TProcedureClient>
    ? unknown
    : RpcConstraintError<
        "layer-procedure-requires-empty-input",
        ProcedureClientInput<TProcedureClient>
      >) &
  (ErrorUnion<TDefinitions> extends ProcedureClientError<TProcedureClient>
    ? unknown
    : RpcConstraintError<
        "layer-procedure-is-missing-layer-errors",
        Exclude<ErrorUnion<TDefinitions>, ProcedureClientError<TProcedureClient>>["_tag"]
      >);

interface LayerShellCommonOptions<
  TParent extends AnyShell,
  TProcedureClient extends QueryProcedureClientLike,
  TValue,
> {
  /**
   * Fires when the layer cannot be established — a load failure the enclosing
   * layers did not claim — and when an operation inside the layer fails with
   * one of the layer's own tags. Must be idempotent.
   */
  readonly onError?: (
    error: SubtractClaimedErrors<
      ProcedureClientError<NoInfer<TProcedureClient>>,
      ClaimedErrorsBy<NoInfer<TParent>>
    >,
    value: TValue | undefined,
  ) => void;
}

/**
 * A layer procedure is either already available, or selected from the provider
 * client at render time. The distinct keys keep two callable values from being
 * distinguished by a runtime heuristic.
 */
export type LayerShellOptions<
  TParent extends AnyShell,
  TProcedureClient extends QueryProcedureClientLike,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
  TClient = unknown,
> = LayerShellCommonOptions<TParent, TProcedureClient, TValue> & { readonly from: TParent } & (
    | {
        readonly procedure: TProcedureClient;
        readonly select?: never;
      }
    | {
        readonly select: (client: TClient) => TProcedureClient;
        readonly procedure?: never;
      }
  ) &
  LayerProcedureCompatibility<TProcedureClient, TValue, TDefinitions>;

declare const layerShellMetadata: unique symbol;

export interface LayerShellMetadata<
  TClient,
  TProcedureClient extends QueryProcedureClientLike,
  THandled extends string = string,
> {
  readonly [layerShellMetadata]: {
    readonly client: TClient;
    readonly procedure: TProcedureClient;
    readonly handled: THandled;
  };
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
const createLayerShell = <
  TClient,
  TKey extends string,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
  TProcedureClient extends QueryProcedureClientLike,
  TParent extends AnyShell,
>(
  useClient: () => TClient,
  layer: LayerShape<TKey, TValue, TDefinitions>,
  options: LayerShellOptions<TParent, TProcedureClient, TValue, TDefinitions, TClient>,
): Shell<TDefinitions, TParent, LayerShellProviderProps, TValue> &
  LayerShellMetadata<TClient, TProcedureClient, TagsOf<TDefinitions> | ClaimedBy<TParent>> => {
  const valueHolder: { current: TValue | undefined } = { current: undefined };
  const inner = defineShell({
    name: layer.name,
    ...(options.from === undefined ? {} : { from: options.from }),
    claims: layer.errors,
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
  const resolveProcedure = (client: TClient): TProcedureClient =>
    options.select === undefined ? options.procedure : options.select(client);
  // Chosen once at definition time, so the wrapped Provider's hook order is stable.
  const useLoad = parent
    ? (): QueryState<TValue, AnyTaggedError> => {
        useAssertChainMounted(internalsOf(parent));
        return useResultQuery(
          resolveProcedure(useClient()),
          {} as ProcedureClientInput<TProcedureClient>,
        ) as unknown as QueryState<TValue, AnyTaggedError>;
      }
    : (): QueryState<TValue, AnyTaggedError> =>
        useResultQuery(
          resolveProcedure(useClient()),
          {} as ProcedureClientInput<TProcedureClient>,
        ) as unknown as QueryState<TValue, AnyTaggedError>;

  /**
   * Re-establishment resumes: when the layer value is loaded anew (a fresh
   * `updatedAt` on the context procedure — e.g. after signing back in), every
   * operation this shell is holding retries automatically.
   */
  const AutoResume = ({
    stamp,
    children,
  }: {
    readonly stamp: number;
    readonly children?: ReactNode;
  }): ReactNode => {
    const active = (inner as AnyShell).useHeld();
    const resumeRef = useRef(active.resume);
    resumeRef.current = active.resume;
    const previous = useRef(stamp);
    useEffect(() => {
      if (stamp === previous.current) return;
      previous.current = stamp;
      resumeRef.current();
    }, [stamp]);
    return children;
  };

  const Provider = ({ children, fallback }: LayerShellProviderProps): ReactNode => {
    const load = useLoad();
    const value = load.state === "success" ? load.value : undefined;
    valueHolder.current = value;
    const failure = load.state === "failure" ? load.error : undefined;
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
      { value: load.value },
      createElement(AutoResume, { stamp: load.updatedAt }, children),
    );
  };

  const shell = { ...inner, Provider } as unknown as Shell<
    TDefinitions,
    TParent,
    LayerShellProviderProps,
    TValue
  > &
    LayerShellMetadata<TClient, TProcedureClient, TagsOf<TDefinitions> | ClaimedBy<TParent>>;
  // The wrapped shell shares the inner shell's identity in the chain registry so
  // child shells can use it as `from:` and hooks resolve the same context.
  internals.set(shell, internalsOf(inner as AnyShell));
  layerResolvers.set(shell, resolveProcedure as (client: unknown) => QueryProcedureClientLike);
  return shell;
};

/** The globally registered, TanStack-style layer-shell constructor. */
export const layerShell = <
  TKey extends string,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
  TProcedureClient extends QueryProcedureClientLike,
  TParent extends AnyShell,
>(
  layer: LayerShape<TKey, TValue, TDefinitions>,
  options: LayerShellOptions<
    TParent,
    TProcedureClient,
    TValue,
    TDefinitions,
    ReturnType<typeof useResultClient>
  >,
) =>
  createLayerShell<
    ReturnType<typeof useResultClient>,
    TKey,
    TValue,
    TDefinitions,
    TProcedureClient,
    TParent
  >(useResultClient, layer, options);

/** Internal building block for `createResultRpcReact<TClient>()`. */
export const bindLayerShell =
  <TClient,>(useClient: () => TClient) =>
  <
    TKey extends string,
    TValue,
    TDefinitions extends ErrorDefinitionMap,
    TProcedureClient extends QueryProcedureClientLike,
    TParent extends AnyShell,
  >(
    layer: LayerShape<TKey, TValue, TDefinitions>,
    options: LayerShellOptions<TParent, TProcedureClient, TValue, TDefinitions, TClient>,
  ) =>
    createLayerShell<TClient, TKey, TValue, TDefinitions, TProcedureClient, TParent>(
      useClient,
      layer,
      options,
    );

const layerResolvers = new WeakMap<AnyShell, (client: unknown) => QueryProcedureClientLike>();

export type LayerProcedureResolver<TShell> =
  TShell extends LayerShellMetadata<infer TClient, infer TProcedureClient, string>
    ? (client: TClient) => TProcedureClient
    : ((client: unknown) => QueryProcedureClientLike) | undefined;

/**
 * Internal: the context-procedure resolver of a layer-derived shell, used by
 * router integrations to derive prefetching loaders. Undefined for plain shells.
 */
export const getLayerProcedureResolver = <TShell extends AnyShell>(
  shell: TShell,
): LayerProcedureResolver<TShell> => layerResolvers.get(shell) as LayerProcedureResolver<TShell>;

export type AnyLayerShell = LayerShellMetadata<any, QueryProcedureClientLike, string> & {
  readonly Provider: (props: LayerShellProviderProps) => ReactNode;
};

export type LayerShellClient<TShell> =
  TShell extends LayerShellMetadata<infer TClient, QueryProcedureClientLike, string>
    ? TClient
    : never;

export type LayerShellProcedure<TShell> =
  TShell extends LayerShellMetadata<any, infer TProcedureClient, string> ? TProcedureClient : never;

/** Prefetches the empty-input context procedure retained by a typed layer shell. */
export const prefetchLayer = <TShell extends AnyLayerShell>(
  runtime: QueryRuntime<LayerShellClient<TShell>>,
  shell: TShell,
  client: LayerShellClient<TShell>,
): Promise<ProcedureClientResult<LayerShellProcedure<TShell>>> => {
  const resolver = layerResolvers.get(shell as unknown as AnyShell) as (
    client: LayerShellClient<TShell>,
  ) => LayerShellProcedure<TShell>;
  const procedure = resolver(client);
  return runtime.prefetch(
    procedure,
    {} as ProcedureClientInput<LayerShellProcedure<TShell>>,
  ) as Promise<ProcedureClientResult<LayerShellProcedure<TShell>>>;
};

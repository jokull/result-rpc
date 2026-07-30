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
  type ReactNode,
} from "react";
import { isTaggedError, type AnyErrorDefinition, type AnyTaggedError } from "../error.js";
import type {
  AnyProcedureClientTypes,
  ClientUnaryTypes,
  ProcedureClientTypeCarrier,
} from "../client/base-client.js";
import type { EmptyObject } from "../wire.js";
import type { RpcConstraintError } from "../type-diagnostics.js";
import type { AnyLayer, LayerShape } from "../layer.js";
import {
  ClaimScopeContext,
  type ClaimEntry,
  type ClaimLease,
  type ClaimRegistry,
} from "./claims.js";
import type { ErrorDefinitionMap, ErrorUnion } from "../server/contract.js";
import type {
  MutationOptions,
  MutationState,
  NarrowProcedureClient,
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

export type ErrorSignature<TError> = TError extends {
  readonly _tag: infer TTag;
  readonly data: infer TData;
  readonly visibility: infer TVisibility;
}
  ? readonly [tag: TTag, data: TData, visibility: TVisibility]
  : never;

export type ErrorData<TError> = TError extends { readonly data: infer TData } ? TData : never;

export type IsTypeEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
      ? true
      : false
    : false;

export type HasExactClaim<TError, TClaimedError> = TClaimedError extends AnyTaggedError
  ? IsTypeEqual<keyof ErrorData<TError>, keyof ErrorData<TClaimedError>> extends true
    ? IsTypeEqual<ErrorSignature<TError>, ErrorSignature<TClaimedError>> extends true
      ? true
      : never
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
  /** How many distinct operations are currently held by this shell. */
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

export type ShellClaimedErrors<
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
  readonly $errors: ShellErrorRegistry<AnyTaggedError>;
  readonly name: string;
  readonly effect: ShellEffect;
  readonly claims: ErrorDefinitionMap;
  readonly parent: AnyShell | undefined;
  readonly ownTags: readonly string[];
  readonly claimedTags: readonly string[];
  use(): unknown;
  useHeld(): ShellHoldings<AnyTaggedError>;
}

interface ShellNode<TError extends AnyTaggedError> {
  readonly acquire: (
    operationId: string,
    leaseId: ClaimLease,
    error: AnyTaggedError,
    retry?: () => void | Promise<void>,
  ) => { readonly fresh: boolean; readonly resumed: Promise<void> };
  readonly release: (operationId: string, leaseId: ClaimLease) => void;
  readonly clear: () => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => ShellHoldings<TError>;
}

interface ShellMount<TValue, TError extends AnyTaggedError> {
  readonly node: ShellNode<TError>;
  readonly value: TValue;
}

interface ShellInternals {
  readonly name: string;
  readonly effect: ShellEffect;
  readonly ownTags: ReadonlySet<string>;
  readonly registry: ShellErrorRegistry<AnyTaggedError>;
  readonly useOptionalMount: () => ShellMount<unknown, AnyTaggedError> | undefined;
  /** Innermost first: `[self, parent, grandparent, ...]`. */
  readonly chain: ShellInternals[];
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

  useQuery<const TProcedureClient extends QueryProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    ...rest: QueryHookArgs<TProcedureClient>
  ): QueryState<
    ProcedureClientOutput<TProcedureClient>,
    SubtractClaimedErrors<
      ProcedureClientError<TProcedureClient>,
      ShellClaimedErrors<TDefinitions, TParent>
    >
  >;

  useSuspenseQuery<const TProcedureClient extends QueryProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
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

  usePaginatedQuery<const TProcedureClient extends PaginatedProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    input: PaginatedClientListInput<NoInfer<TProcedureClient>>,
    options?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>,
  ): PaginatedState<
    PaginatedClientItem<TProcedureClient>,
    SubtractClaimedErrors<
      ProcedureClientError<TProcedureClient>,
      ShellClaimedErrors<TDefinitions, TParent>
    >
  >;

  useMutation<const TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    options?: MutationOptions<
      ProcedureClientInput<TProcedureClient>,
      ProcedureClientOutput<TProcedureClient>,
      SubtractClaimedErrors<
        ProcedureClientError<TProcedureClient>,
        ShellClaimedErrors<TDefinitions, TParent>
      >,
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

  useSubscription<const TProcedureClient extends SubscriptionProcedureClientLike>(
    procedure: NarrowProcedureClient<TProcedureClient>,
    ...rest: SubscriptionHookArgs<TProcedureClient>
  ): SubscriptionState<
    SubscriptionClientOutput<TProcedureClient>,
    SubtractClaimedErrors<
      SubscriptionClientError<TProcedureClient>,
      ShellClaimedErrors<TDefinitions, TParent>
    >
  >;
}

export type ClaimedBy<TShell> = AnyShell extends TShell
  ? string
  : TShell extends {
        readonly claims: infer TDefinitions extends ErrorDefinitionMap;
        readonly parent: infer TParent;
      }
    ? TagsOf<TDefinitions> | ClaimedBy<TParent>
    : never;

export type ClaimedErrorsBy<TShell> = AnyShell extends TShell
  ? AnyTaggedError
  : TShell extends {
        readonly claims: infer TDefinitions extends ErrorDefinitionMap;
        readonly parent: infer TParent;
      }
    ? ErrorUnion<TDefinitions> | ClaimedErrorsBy<TParent>
    : never;

export type ValueOf<TShell> = TShell extends { use(): infer TValue } ? TValue : never;

export type ShellClaimCompatibility<
  TParent extends AnyShell | undefined,
  TDefinitions extends ErrorDefinitionMap,
> = TParent extends AnyShell
  ? [Extract<TagsOf<TDefinitions>, ClaimedBy<TParent>>] extends [never]
    ? unknown
    : RpcConstraintError<
        "shell-claim-already-owned-by-parent",
        Extract<TagsOf<TDefinitions>, ClaimedBy<TParent>>
      >
  : unknown;

export type DefineShellOptions<
  TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined,
  TProps,
  TValue,
> = ShellCommonOptions<TDefinitions, TValue> &
  ShellParentOption<TParent> &
  ShellProviderOption<TProps, TValue> &
  ShellClaimCompatibility<TParent, TDefinitions>;

export type ShellParentOption<TParent extends AnyShell | undefined> = TParent extends AnyShell
  ? { readonly from: TParent }
  : { readonly from?: never };

export type ShellProviderOption<TProps, TValue> =
  | {
      /** Builds the value guaranteed by this shell from its Provider props. */
      readonly provide: (props: TProps) => TValue;
    }
  | ([TValue] extends [void] ? { readonly provide?: never } : never);

export type ShellCommonOptions<TDefinitions extends ErrorDefinitionMap, TValue> = {
  /** Used in mount diagnostics and devtools. */
  readonly name: string;
  /** The error definitions this shell claims. Pass the same map given to `.errors()`. */
  readonly claims: TDefinitions;
} & (
  | {
      /** Pause is the default: the shell holds failures until `resume()`. */
      readonly effect?: "pause";
      /** Runs once per newly paused error. Recovery attempts may report again. */
      readonly onError?: (error: ErrorUnion<TDefinitions>, value: NoInfer<TValue>) => void;
    }
  | {
      /** Delegates the exact tagged error to the nearest React error boundary. */
      readonly effect: "escalate";
      /** Escalation is observed by the React error boundary, not a shell reaction. */
      readonly onError?: never;
    }
);

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
): ShellNode<TError> => {
  const entries = new Map<
    string,
    {
      readonly error: TError;
      readonly leases: Map<ClaimLease, (() => void | Promise<void>) | undefined>;
      readonly resumed: Promise<void>;
      readonly resolve: () => void;
    }
  >();
  const listeners = new Set<() => void>();
  const retryAll = () => {
    const holdings = [...entries.values()];
    if (holdings.length === 0) return;
    entries.clear();
    recompute();
    for (const holding of holdings) {
      const retry = [...holding.leases.values()].find(
        (candidate): candidate is () => void | Promise<void> => candidate !== undefined,
      );
      try {
        Promise.resolve(retry?.()).then(holding.resolve, holding.resolve);
      } catch {
        holding.resolve();
      }
    }
  };
  let snapshot: ShellHoldings<TError> = Object.freeze({
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
  };
  const release = (operationId: string, leaseId: ClaimLease) => {
    const holding = entries.get(operationId);
    if (!holding) return;
    holding.leases.delete(leaseId);
    if (holding.leases.size !== 0) return;
    entries.delete(operationId);
    recompute();
    holding.resolve();
  };
  return {
    acquire: (operationId, leaseId, error, retry) => {
      if (!registry.is(error)) {
        throw new TypeError(
          `Shell ${name} received ${error._tag} from a different error definition`,
        );
      }
      const existing = entries.get(operationId);
      if (existing?.error === error) {
        existing.leases.set(leaseId, retry);
        return { fresh: false, resumed: existing.resumed };
      }
      if (existing) {
        entries.delete(operationId);
        existing.resolve();
      }
      let resolve: () => void = () => undefined;
      const resumed = new Promise<void>((resume) => {
        resolve = resume;
      });
      entries.set(operationId, { error, leases: new Map([[leaseId, retry]]), resumed, resolve });
      recompute();
      onError?.(error, valueRef.current);
      return { fresh: true, resumed };
    },
    release,
    clear: () => {
      const holdings = [...entries.values()];
      entries.clear();
      recompute();
      for (const holding of holdings) holding.resolve();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => snapshot,
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

interface ShellCoreOptions<
  TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined,
  TValue,
> {
  readonly name: string;
  readonly parent: TParent;
  readonly claims: TDefinitions;
  readonly effect: ShellEffect;
  readonly onError?: (error: ErrorUnion<TDefinitions>, value: TValue) => void;
}

interface ShellProviderTools<TValue, TError extends AnyTaggedError> {
  readonly Mount: (props: { readonly value: TValue; readonly children?: ReactNode }) => ReactNode;
  readonly useHeld: () => ShellHoldings<TError>;
}

const createShellCore = <
  const TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined,
  TProps,
  TValue,
>(
  options: ShellCoreOptions<TDefinitions, TParent, TValue>,
  createProvider: (
    tools: ShellProviderTools<TValue, ErrorUnion<TDefinitions>>,
  ) => (props: TProps & { readonly children?: ReactNode }) => ReactNode,
): Shell<TDefinitions, TParent, TProps, TValue> => {
  const parent: AnyShell | undefined = options.parent;
  const parentInternals = parent ? internalsOf(parent) : undefined;
  const ownRegistry = createShellErrorRegistry(options.name, options.claims);
  const ownTags = new Set(ownRegistry.definitions.keys());
  for (const enclosing of parentInternals?.chain ?? []) {
    for (const tag of ownTags) {
      if (enclosing.ownTags.has(tag)) {
        throw new TypeError(
          `Shell ${options.name} claims ${tag}, already claimed by ${enclosing.name}`,
        );
      }
    }
  }

  const context = createContext<ShellMount<TValue, ErrorUnion<TDefinitions>> | undefined>(
    undefined,
  );
  const useOptionalMount = () => useContext(context);
  const effect = options.effect;
  const self: ShellInternals = {
    name: options.name,
    effect,
    ownTags,
    registry: ownRegistry,
    useOptionalMount,
    chain: [],
  };
  self.chain.push(self, ...(parentInternals?.chain ?? []));

  const useParentMount = parentInternals?.useOptionalMount ?? (() => undefined);

  const Mount = ({
    value,
    children,
  }: {
    readonly value: TValue;
    readonly children?: ReactNode;
  }) => {
    const enclosing = useParentMount();
    if (parentInternals && !enclosing) {
      throw new TypeError(`Shell ${options.name} must be mounted inside ${parentInternals.name}`);
    }
    const valueRef = useRef<TValue>(value);
    valueRef.current = value;
    const [node] = useState(() => createNode(options.name, ownRegistry, options.onError, valueRef));
    useEffect(() => () => node.clear(), [node]);
    const mount = useMemo<ShellMount<TValue, ErrorUnion<TDefinitions>>>(
      () => ({ node, value }),
      [node, value],
    );
    const parentScope = useContext(ClaimScopeContext);
    const entry = useMemo<ClaimEntry>(
      () => ({
        name: options.name,
        effect,
        registry: ownRegistry,
        acquire: node.acquire,
        release: node.release,
      }),
      [node],
    );
    const scope = useMemo(() => [...parentScope, entry], [parentScope, entry]);
    return createElement(
      context.Provider,
      { value: mount },
      createElement(ClaimScopeContext.Provider, { value: scope }, children),
    );
  };

  const useMount = (): ShellMount<TValue, ErrorUnion<TDefinitions>> => {
    const mount = useOptionalMount();
    if (!mount) throw new TypeError(`Shell ${options.name} is not mounted`);
    return mount;
  };

  const useHeld = (): ShellHoldings<ErrorUnion<TDefinitions>> => {
    const { node } = useMount();
    return useSyncExternalStore(node.subscribe, node.snapshot, node.snapshot);
  };

  const Provider = createProvider({ Mount, useHeld });

  const claimedDefinitions = new Map<string, AnyErrorDefinition>();
  for (const layer of self.chain) {
    for (const [tag, definition] of layer.registry.definitions) {
      claimedDefinitions.set(tag, definition);
    }
  }

  // Hook implementations below are generic in their exact callable argument.
  // Object-literal checking cannot express the correlated return subtraction,
  // so construction restores the Shell interface once, after all methods and
  // the eager mount proof have been installed.
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
    parent: options.parent,
    ownTags: [...ownTags],
    claimedTags: self.chain.flatMap((layer) => [...layer.ownTags]),
    Provider,
    use: () => useMount().value,
    useHeld,
    // Absorption is ambient (any hook under the providers); the shell hooks add
    // the type subtraction and an eager proof that the whole chain is mounted,
    // so the narrowed union can never outrun its owners.
    useQuery: <TProcedureClient extends QueryProcedureClientLike>(
      procedure: NarrowProcedureClient<TProcedureClient>,
      ...rest: QueryHookArgs<TProcedureClient>
    ) => {
      useAssertChainMounted(self);
      return useResultQuery(procedure, ...rest);
    },
    useSuspenseQuery: <TProcedureClient extends QueryProcedureClientLike>(
      procedure: NarrowProcedureClient<TProcedureClient>,
      ...rest: QueryHookArgs<TProcedureClient>
    ) => {
      useAssertChainMounted(self);
      return useResultSuspenseQuery(procedure, ...rest);
    },
    usePaginatedQuery: <TProcedureClient extends PaginatedProcedureClientLike>(
      procedure: NarrowProcedureClient<TProcedureClient>,
      input: PaginatedClientListInput<NoInfer<TProcedureClient>>,
      queryOptions?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>,
    ) => {
      useAssertChainMounted(self);
      return useResultPaginatedQuery(procedure, input, queryOptions);
    },
    useMutation: <TProcedureClient extends MutationProcedureClientLike, TContext = undefined>(
      procedure: NarrowProcedureClient<TProcedureClient>,
      mutationOptions?: MutationOptions<
        ProcedureClientInput<TProcedureClient>,
        ProcedureClientOutput<TProcedureClient>,
        ProcedureClientError<TProcedureClient>,
        TContext
      >,
    ) => {
      useAssertChainMounted(self);
      return useResultMutation(procedure, mutationOptions);
    },
    useSubscription: <TProcedureClient extends SubscriptionProcedureClientLike>(
      procedure: NarrowProcedureClient<TProcedureClient>,
      ...rest: SubscriptionHookArgs<TProcedureClient>
    ) => {
      useAssertChainMounted(self);
      return useResultSubscription(procedure, ...rest);
    },
  } as unknown as Shell<TDefinitions, TParent, TProps, TValue>;

  internals.set(shell, self);
  return shell;
};

export type ProvidedShellOptions<
  TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined,
  TProps,
  TValue,
> = ShellCommonOptions<TDefinitions, TValue> &
  ShellParentOption<TParent> & {
    readonly provide: (props: TProps) => TValue;
  } & ShellClaimCompatibility<TParent, TDefinitions>;

export type VoidShellOptions<
  TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined,
> = ShellCommonOptions<TDefinitions, void> &
  ShellParentOption<TParent> & { readonly provide?: never } & ShellClaimCompatibility<
    TParent,
    TDefinitions
  >;

interface RuntimeShellOptions {
  readonly name: string;
  readonly from?: AnyShell;
  readonly claims: ErrorDefinitionMap;
  readonly effect?: ShellEffect;
  readonly onError?: (error: never, value: never) => void;
  readonly provide?: (props: never) => unknown;
}

/** A value-providing shell: its Provider props and value are inferred together. */
export function defineShell<
  const TDefinitions extends ErrorDefinitionMap,
  TProps,
  TValue,
  TParent extends AnyShell | undefined = undefined,
>(
  options: ProvidedShellOptions<TDefinitions, TParent, TProps, TValue>,
): Shell<TDefinitions, TParent, TProps, TValue>;

/** An error-only shell: it provides exactly `void`, never a caller-selected value. */
export function defineShell<
  const TDefinitions extends ErrorDefinitionMap,
  TParent extends AnyShell | undefined = undefined,
>(
  options: VoidShellOptions<TDefinitions, TParent>,
): Shell<TDefinitions, TParent, Record<never, never>, void>;

export function defineShell(options: RuntimeShellOptions): AnyShell {
  if (options.effect === "escalate" && options.onError !== undefined) {
    throw new TypeError(
      `Escalating shell ${options.name} delegates observability to its React error boundary`,
    );
  }
  if (Object.keys(options.claims).length === 0 && options.provide === undefined) {
    throw new TypeError(`Shell ${options.name} claims no errors and provides no value`);
  }
  const report = options.onError;
  const provide = options.provide;
  return createShellCore(
    {
      name: options.name,
      parent: options.from,
      claims: options.claims,
      effect: options.effect ?? "pause",
      ...(report === undefined
        ? {}
        : {
            // RuntimeShellOptions is deliberately contravariant (`never`) so
            // every specific callback can enter the erased implementation.
            onError: (error: AnyTaggedError, value: unknown) =>
              report(error as never, value as never),
          }),
    },
    ({ Mount }) =>
      (props) => {
        // The overloads prove that absence means `void`; provided callbacks are
        // invoked only at this erased React-props boundary.
        const value = provide === undefined ? undefined : provide(props as never);
        return createElement(Mount, { value }, props.children);
      },
  );
}

/**
 * Eagerly proves the shell's whole chain is mounted. The type subtraction on a
 * shell hook is only honest if every claimed tag has a live owner above.
 */
const useAssertChainMounted = (shell: ShellInternals): void => {
  // The chain is fixed at definition time, so this hook count is stable per call site.
  for (const layer of shell.chain) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const mount = layer.useOptionalMount();
    if (!mount) throw new TypeError(`Shell ${layer.name} is not mounted`);
  }
};

// --- Layer shells ----------------------------------------------------------

export type Exact<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false;

export type LayerQueryProcedureClient<TValue> = QueryProcedureClientLike &
  ProcedureClientTypeCarrier<
    AnyProcedureClientTypes & {
      readonly input: EmptyObject;
      readonly output: TValue;
      readonly kind: "query";
      readonly capability: ClientUnaryTypes;
    }
  >;

export type LayerProcedureCompatibility<
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

export type LayerReactionError<
  TParent extends AnyShell,
  TProcedureClient extends QueryProcedureClientLike,
  TDefinitions extends ErrorDefinitionMap,
> =
  | ErrorUnion<TDefinitions>
  | SubtractClaimedErrors<ProcedureClientError<TProcedureClient>, ClaimedErrorsBy<TParent>>;

export interface LayerShellCommonOptions<
  TParent extends AnyShell,
  TProcedureClient extends QueryProcedureClientLike,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
> {
  /** Cache policy for the empty-input context query that establishes the layer. */
  readonly load?: QueryOptions<ProcedureClientError<NoInfer<TProcedureClient>>>;
  /**
   * Fires when the layer cannot be established — a load failure the enclosing
   * layers did not claim — and when an operation inside the layer fails with
   * one of the layer's own tags. Must be idempotent.
   */
  readonly onError?: (
    error: LayerReactionError<NoInfer<TParent>, NoInfer<TProcedureClient>, TDefinitions>,
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
> = LayerShellCommonOptions<TParent, TProcedureClient, TValue, TDefinitions> & {
  readonly from: TParent;
} & (
    | {
        readonly procedure: NarrowProcedureClient<TProcedureClient>;
        readonly select?: never;
      }
    | {
        readonly select: (client: TClient) => NarrowProcedureClient<TProcedureClient>;
        readonly procedure?: never;
      }
  ) &
  LayerProcedureCompatibility<TProcedureClient, TValue, TDefinitions> &
  ShellClaimCompatibility<TParent, TDefinitions>;

export interface LayerShellMetadata<
  TClient,
  TProcedureClient extends QueryProcedureClientLike,
  TKey extends string,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
> {
  /** The shared declaration from which this shell was derived. */
  readonly layer: LayerShape<TKey, TValue, TDefinitions>;
  /** Selects the declaration's context procedure from a concrete client. */
  readonly resolveProcedure: (client: TClient) => NarrowProcedureClient<TProcedureClient>;
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
  TProcedureClient extends LayerQueryProcedureClient<TValue>,
  TParent extends AnyShell,
>(
  useClient: () => TClient,
  layer: LayerShape<TKey, TValue, TDefinitions>,
  options: LayerShellOptions<TParent, TProcedureClient, TValue, TDefinitions, TClient>,
): Shell<TDefinitions, TParent, LayerShellProviderProps, TValue> &
  LayerShellMetadata<TClient, TProcedureClient, TKey, TValue, TDefinitions> => {
  const resolveProcedure = (client: TClient): NarrowProcedureClient<TProcedureClient> =>
    options.select === undefined ? options.procedure : options.select(client);
  const shell = createShellCore(
    {
      name: layer.name,
      parent: options.from,
      claims: layer.errors,
      effect: "pause",
      ...(options.onError === undefined
        ? {}
        : {
            onError: (error: ErrorUnion<TDefinitions>, value: TValue) =>
              options.onError?.(error, value),
          }),
    },
    ({ Mount, useHeld }) => {
      /**
       * Re-establishment resumes: a fresh context value retries every operation
       * held by this exact provider mount. Sibling mounts have independent nodes.
       */
      const AutoResume = ({
        stamp,
        children,
      }: {
        readonly stamp: number;
        readonly children?: ReactNode;
      }): ReactNode => {
        const active = useHeld();
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

      return ({ children, fallback }: LayerShellProviderProps): ReactNode => {
        useAssertChainMounted(internalsOf(options.from));
        const load = useResultQuery(resolveProcedure(useClient()), {}, options.load ?? {});
        const failure = load.state === "failure" ? load.error : undefined;
        useEffect(() => {
          if (failure && !options.from.$errors.is(failure)) {
            options.onError?.(failure, undefined);
          }
        }, [failure]);
        if (load.state !== "success") return fallback ?? null;
        return createElement(
          Mount,
          { value: load.value },
          createElement(AutoResume, { stamp: load.updatedAt }, children),
        );
      };
    },
  );
  return Object.assign(shell, { layer, resolveProcedure });
};

/** The globally registered, TanStack-style layer-shell constructor. */
export const layerShell = <
  TKey extends string,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
  TProcedureClient extends LayerQueryProcedureClient<TValue>,
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

/** A layer-shell constructor bound to one concrete client environment. */
export type LayerShellFactory<TClient> = <
  TKey extends string,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
  TProcedureClient extends LayerQueryProcedureClient<TValue>,
  TParent extends AnyShell,
>(
  layer: LayerShape<TKey, TValue, TDefinitions>,
  options: LayerShellOptions<TParent, TProcedureClient, TValue, TDefinitions, TClient>,
) => Shell<TDefinitions, TParent, LayerShellProviderProps, TValue> &
  LayerShellMetadata<TClient, TProcedureClient, TKey, TValue, TDefinitions>;

/** Internal building block for `createResultRpcReact<TClient>()`. */
export function bindLayerShell<TClient>(useClient: () => TClient): LayerShellFactory<TClient>;
// The implementation return is erased because TypeScript cannot compare two
// higher-rank callbacks whose option objects contain contravariant `onError`
// parameters. The overload is the exact factory algebra implemented below.
export function bindLayerShell<TClient>(useClient: () => TClient): unknown {
  return <
    TKey extends string,
    TValue,
    TDefinitions extends ErrorDefinitionMap,
    TProcedureClient extends LayerQueryProcedureClient<TValue>,
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
}

export interface AnyLayerShell extends AnyShell {
  readonly layer: AnyLayer;
  /** The exact LayerShellMetadata carrier is required before this can be called. */
  readonly resolveProcedure: (client: never) => QueryProcedureClientLike;
  readonly Provider: (props: LayerShellProviderProps) => ReactNode;
}

export type LayerShellClient<TShell> =
  TShell extends LayerShellMetadata<
    infer TClient,
    infer _TProcedureClient,
    infer _TKey,
    infer _TValue,
    infer _TDefinitions
  >
    ? TClient
    : never;

export type LayerShellProcedure<TShell> =
  TShell extends LayerShellMetadata<
    infer _TClient,
    infer TProcedureClient,
    infer _TKey,
    infer _TValue,
    infer _TDefinitions
  >
    ? TProcedureClient
    : never;

/** Prefetches the empty-input context procedure retained by a typed layer shell. */
export const prefetchLayer = <TShell extends AnyLayerShell>(
  runtime: QueryRuntime<LayerShellClient<TShell>>,
  shell: TShell,
  client: LayerShellClient<TShell>,
): Promise<ProcedureClientResult<LayerShellProcedure<TShell>>> => {
  // Associated metadata above proves this client belongs to this shell; the
  // erased interface deliberately accepts no constructible input.
  const procedure = shell.resolveProcedure(client as never);
  return runtime.prefetch(procedure, {});
};

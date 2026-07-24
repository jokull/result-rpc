import type {
  AnyErrorDefinition,
  AnyTaggedError,
  ErrorOf,
} from "../error.js";
import { badRequestFromIssues, ServerBadRequest, ServerInternal } from "../framework-errors.js";
import type { AnyModel } from "../model.js";
import { err, ok, type Result } from "../result.js";
import { wire } from "../wire.js";
import type { WireCodec, WireValue } from "../wire.js";

export type ErrorDefinitionMap = Readonly<Record<string, AnyErrorDefinition>>;
export type ErrorUnion<TDefinitions extends ErrorDefinitionMap> = ErrorOf<
  TDefinitions[keyof TDefinitions]
>;

type MaybePromise<T> = T | Promise<T>;

export interface InternalErrorEvent {
  readonly incidentId: string;
  readonly phase: "input" | "context" | "middleware" | "handler" | "output" | "error";
  readonly cause: unknown;
  readonly procedurePath?: string;
}

export interface ExecutionOptions<TRootContext> {
  readonly context: TRootContext;
  readonly procedurePath?: string;
  readonly onInternalError?: (event: InternalErrorEvent) => void;
}

declare const middlewareNextResult: unique symbol;
type MiddlewareNextResult = Result<unknown, AnyTaggedError> & {
  readonly [middlewareNextResult]: true;
};

interface MiddlewareNext<TContext> {
  (options: {
    readonly context: TContext;
  }): Promise<MiddlewareNextResult>;
}

export interface MiddlewareHandlerArgs<
  TInputContext,
  TOutputContext,
  TDefinitions extends ErrorDefinitionMap,
> {
  readonly context: TInputContext;
  readonly errors: TDefinitions;
  readonly next: MiddlewareNext<TOutputContext>;
}

export type MiddlewareHandler<
  TInputContext,
  TOutputContext,
  TDefinitions extends ErrorDefinitionMap,
> = (
  args: MiddlewareHandlerArgs<TInputContext, TOutputContext, TDefinitions>,
) => MaybePromise<Result<unknown, ErrorUnion<TDefinitions>> | MiddlewareNextResult>;

type ErasedMiddlewareHandler = (args: {
  readonly context: unknown;
  readonly errors: ErrorDefinitionMap;
  readonly next: (options: { readonly context: unknown }) => Promise<Result<unknown, AnyTaggedError>>;
}) => MaybePromise<Result<unknown, AnyTaggedError>>;

interface RuntimeMiddleware {
  readonly definitions: ErrorDefinitionMap;
  readonly handler: ErasedMiddlewareHandler;
  /** Middleware this one depends on; flattened and deduped at `.use()` time. */
  readonly requires: readonly RuntimeMiddleware[];
}

/** Dependencies first, then the middleware itself; duplicates removed by reference. */
const flattenMiddleware = (middleware: RuntimeMiddleware): readonly RuntimeMiddleware[] => {
  const seen = new Set<RuntimeMiddleware>();
  const ordered: RuntimeMiddleware[] = [];
  const visit = (current: RuntimeMiddleware) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const dependency of current.requires) visit(dependency);
    ordered.push(current);
  };
  visit(middleware);
  return ordered;
};

const appendMiddleware = (
  existing: readonly RuntimeMiddleware[],
  middleware: RuntimeMiddleware,
): readonly RuntimeMiddleware[] => [
  ...existing,
  ...flattenMiddleware(middleware).filter((candidate) => !existing.includes(candidate)),
];

export interface Middleware<
  TInputContext,
  TOutputContext,
  TDefinitions extends ErrorDefinitionMap,
> {
  readonly _kind: "middleware";
  readonly definitions: TDefinitions;
  readonly handler: ErasedMiddlewareHandler;
  readonly requires: readonly RuntimeMiddleware[];
  readonly _types?: {
    /** Contravariant: a middleware needing less context works with more. */
    readonly inputContext: (context: TInputContext) => void;
    readonly outputContext: TOutputContext;
    readonly error: ErrorUnion<TDefinitions>;
  };
}

export class MiddlewareBuilder<
  TInputContext,
  TAdded = {},
  TDefinitions extends ErrorDefinitionMap = {},
  TOuterInput = TInputContext,
> {
  constructor(
    private readonly definitions: TDefinitions = {} as TDefinitions,
    private readonly dependencies: readonly RuntimeMiddleware[] = [],
  ) {}

  errors<const TNewDefinitions extends ErrorDefinitionMap>(
    definitions: TNewDefinitions,
  ): MiddlewareBuilder<TInputContext, TAdded, TDefinitions & TNewDefinitions, TOuterInput> {
    assertDefinitionsCanMerge(this.definitions, definitions);
    return new MiddlewareBuilder({ ...this.definitions, ...definitions }, this.dependencies);
  }

  /**
   * Declares a middleware this one depends on. The handler's input context
   * becomes the dependency's output context, the dependency's errors join this
   * middleware's union, and any `.use()` site pulls the dependency in
   * automatically — deduplicated by reference when several middleware share it.
   */
  after<TDependencyOutput, TDependencyDefinitions extends ErrorDefinitionMap>(
    dependency: Middleware<TInputContext, TDependencyOutput, TDependencyDefinitions>,
  ): MiddlewareBuilder<
    TDependencyOutput,
    TAdded,
    TDefinitions & TDependencyDefinitions,
    TOuterInput
  > {
    assertDefinitionsCanMerge(this.definitions, dependency.definitions);
    return new MiddlewareBuilder(
      { ...this.definitions, ...dependency.definitions },
      [...this.dependencies, dependency as unknown as RuntimeMiddleware],
    );
  }

  use(
    handler: MiddlewareHandler<TInputContext, TInputContext & TAdded, TDefinitions>,
  ): Middleware<TOuterInput, TInputContext & TAdded, TDefinitions> {
    return Object.freeze({
      _kind: "middleware" as const,
      definitions: this.definitions,
      handler: handler as ErasedMiddlewareHandler,
      requires: this.dependencies,
    });
  }
}

export interface ProcedureHandlerArgs<
  TContext,
  TInput,
  TDefinitions extends ErrorDefinitionMap,
> {
  readonly context: TContext;
  readonly input: TInput;
  readonly errors: TDefinitions;
}

/**
 * A mutation's declared blast radius: which query it invalidates on success,
 * and how the mutation's input maps to the query's. Declared once at the
 * contract, executed automatically by the client cache — no `onSettled`
 * plumbing at call sites. Without `map`, every cached input of the target
 * query is invalidated.
 */
export interface AffectsEntry {
  readonly target: AnyProcedureContract | AnyUnaryProcedure;
  readonly map?: (input: never) => unknown;
}

/**
 * A mutation's declared entity write for outputs that don't carry the
 * entity: `.writes(Doc, (input) => input.id)` invalidates every cached query
 * containing that entity — the invalidation-only sibling of returning the
 * entity (which patches).
 */
export interface WritesEntry {
  readonly model: AnyModel;
  readonly map: (input: never) => string | number;
}

export interface ProcedureManifest<
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
  TKind extends "query" | "mutation" | "subscription" = "query" | "mutation" | "subscription",
> {
  readonly kind: TKind;
  readonly input: WireCodec<TInput, WireValue>;
  readonly output: WireCodec<TOutput, WireValue>;
  readonly definitions: TDefinitions;
  readonly affects?: readonly AffectsEntry[];
  readonly writes?: readonly WritesEntry[];
  readonly middlewares: readonly RuntimeMiddleware[];
  readonly handler: (
    args: ProcedureHandlerArgs<unknown, TInput, TDefinitions>,
  ) => MaybePromise<Result<TOutput, ErrorUnion<TDefinitions>>>;
  readonly _rootContext?: TRootContext;
}

export interface ProcedureContractManifest<
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
  TKind extends "query" | "mutation" | "subscription" = "query" | "mutation" | "subscription",
> {
  readonly kind: TKind;
  readonly input: WireCodec<TInput, WireValue>;
  readonly output: WireCodec<TOutput, WireValue>;
  readonly definitions: TDefinitions;
  readonly affects?: readonly AffectsEntry[];
  readonly writes?: readonly WritesEntry[];
  readonly _rootContext?: TRootContext;
}

export interface ProcedureContract<
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
  TKind extends "query" | "mutation" | "subscription" = "query" | "mutation" | "subscription",
> {
  readonly _kind: "procedure-contract";
  readonly _def: ProcedureContractManifest<TRootContext, TInput, TOutput, TDefinitions, TKind>;
}

export interface Procedure<
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
  TKind extends "query" | "mutation" | "subscription" = "query" | "mutation" | "subscription",
> {
  readonly _kind: "procedure";
  readonly _def: ProcedureManifest<TRootContext, TInput, TOutput, TDefinitions, TKind>;
}

export interface SubscriptionProcedureManifest<
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
> extends ProcedureContractManifest<TRootContext, TInput, TOutput, TDefinitions, "subscription"> {
  readonly middlewares: readonly RuntimeMiddleware[];
  readonly handler: (
    args: ProcedureHandlerArgs<unknown, TInput, TDefinitions>,
  ) => MaybePromise<AsyncIterable<Result<TOutput, ErrorUnion<TDefinitions>>>>;
}

export interface SubscriptionProcedure<
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
> {
  readonly _kind: "subscription-procedure";
  readonly _def: SubscriptionProcedureManifest<TRootContext, TInput, TOutput, TDefinitions>;
}

export type AnyUnaryProcedure = Procedure<any, any, any, any, "query" | "mutation">;
export type AnySubscriptionProcedure = SubscriptionProcedure<any, any, any, any>;
export type AnyProcedure = AnyUnaryProcedure | AnySubscriptionProcedure;
export type AnyProcedureContract = ProcedureContract<any, any, any, any>;

export class ProcedureBuilder<
  TRootContext,
  TContext = TRootContext,
  TInput = Record<never, never>,
  TOutput = never,
  TDefinitions extends ErrorDefinitionMap = {},
> {
  constructor(
    private readonly inputCodec?: WireCodec<TInput, WireValue>,
    private readonly outputCodec?: WireCodec<TOutput, WireValue>,
    private readonly definitions: TDefinitions = {} as TDefinitions,
    private readonly middlewares: readonly RuntimeMiddleware[] = [],
    private readonly affectsEntries: readonly AffectsEntry[] = [],
    private readonly writesEntries: readonly WritesEntry[] = [],
  ) {}

  /**
   * Declares the entity this mutation writes when the output doesn't carry
   * it. Invalidation-only: returning the entity instead earns in-place
   * patches everywhere it appears.
   */
  writes<TModel extends AnyModel>(
    model: TModel,
    map: (input: TInput) => string | number,
  ): ProcedureBuilder<TRootContext, TContext, TInput, TOutput, TDefinitions> {
    return new ProcedureBuilder(
      this.inputCodec,
      this.outputCodec,
      this.definitions,
      this.middlewares,
      this.affectsEntries,
      [...this.writesEntries, { model, map: map as WritesEntry["map"] }],
    );
  }

  /**
   * Declares that this mutation invalidates a query on success. `map` turns
   * the mutation's input into the target query's input; omit it to invalidate
   * every cached input of that query. Executed automatically by the client
   * cache — call sites need no `onSettled`.
   */
  affects<TTargetInput>(
    target:
      | ProcedureContract<any, TTargetInput, any, any, "query">
      | Procedure<any, TTargetInput, any, any, "query">,
    map?: (input: TInput) => TTargetInput,
  ): ProcedureBuilder<TRootContext, TContext, TInput, TOutput, TDefinitions> {
    if (target._def.kind !== "query") {
      throw new TypeError("affects() targets must be query procedures");
    }
    const entry: AffectsEntry = map === undefined
      ? { target }
      : { target, map: map as (input: never) => unknown };
    return new ProcedureBuilder(
      this.inputCodec,
      this.outputCodec,
      this.definitions,
      this.middlewares,
      [...this.affectsEntries, entry],
      this.writesEntries,
    );
  }

  input<TNewInput, TEncoded extends WireValue>(
    codec: WireCodec<TNewInput, TEncoded>,
  ): ProcedureBuilder<TRootContext, TContext, TNewInput, TOutput, TDefinitions> {
    return new ProcedureBuilder(
      codec as WireCodec<TNewInput, WireValue>,
      this.outputCodec,
      this.definitions,
      this.middlewares,
      this.affectsEntries,
      this.writesEntries,
    );
  }

  output<TNewOutput, TEncoded extends WireValue>(
    codec: WireCodec<TNewOutput, TEncoded>,
  ): ProcedureBuilder<TRootContext, TContext, TInput, TNewOutput, TDefinitions> {
    return new ProcedureBuilder(
      this.inputCodec,
      codec as WireCodec<TNewOutput, WireValue>,
      this.definitions,
      this.middlewares,
      this.affectsEntries,
      this.writesEntries,
    );
  }

  errors<const TNewDefinitions extends ErrorDefinitionMap>(
    definitions: TNewDefinitions,
  ): ProcedureBuilder<
    TRootContext,
    TContext,
    TInput,
    TOutput,
    TDefinitions & TNewDefinitions
  > {
    assertDefinitionsCanMerge(this.definitions, definitions);
    return new ProcedureBuilder(
      this.inputCodec,
      this.outputCodec,
      { ...this.definitions, ...definitions },
      this.middlewares,
      this.affectsEntries,
      this.writesEntries,
    );
  }

  use<TOutputContext, TMiddlewareDefinitions extends ErrorDefinitionMap>(
    middleware: Middleware<TContext, TOutputContext, TMiddlewareDefinitions>,
  ): ProcedureBuilder<
    TRootContext,
    TOutputContext,
    TInput,
    TOutput,
    TDefinitions & TMiddlewareDefinitions
  > {
    assertDefinitionsCanMerge(this.definitions, middleware.definitions);
    const definitions = {
      ...this.definitions,
      ...middleware.definitions,
    } as TDefinitions & TMiddlewareDefinitions;
    return new ProcedureBuilder<
      TRootContext,
      TOutputContext,
      TInput,
      TOutput,
      TDefinitions & TMiddlewareDefinitions
    >(
      this.inputCodec,
      this.outputCodec,
      definitions,
      appendMiddleware(this.middlewares, middleware as unknown as RuntimeMiddleware),
      this.affectsEntries,
      this.writesEntries,
    );
  }

  query(): ProcedureContract<TRootContext, TInput, TOutput, TDefinitions, "query">;
  query(
    handler: (
      args: ProcedureHandlerArgs<TContext, TInput, TDefinitions>,
    ) => MaybePromise<Result<TOutput, ErrorUnion<TDefinitions>>>,
  ): Procedure<TRootContext, TInput, TOutput, TDefinitions, "query">;
  query(
    handler?: (
      args: ProcedureHandlerArgs<TContext, TInput, TDefinitions>,
    ) => MaybePromise<Result<TOutput, ErrorUnion<TDefinitions>>>,
  ):
    | ProcedureContract<TRootContext, TInput, TOutput, TDefinitions, "query">
    | Procedure<TRootContext, TInput, TOutput, TDefinitions, "query"> {
    return handler === undefined
      ? this.finishContract("query")
      : this.finish("query", handler);
  }

  mutation(): ProcedureContract<TRootContext, TInput, TOutput, TDefinitions, "mutation">;
  mutation(
    handler: (
      args: ProcedureHandlerArgs<TContext, TInput, TDefinitions>,
    ) => MaybePromise<Result<TOutput, ErrorUnion<TDefinitions>>>,
  ): Procedure<TRootContext, TInput, TOutput, TDefinitions, "mutation">;
  mutation(
    handler?: (
      args: ProcedureHandlerArgs<TContext, TInput, TDefinitions>,
    ) => MaybePromise<Result<TOutput, ErrorUnion<TDefinitions>>>,
  ):
    | ProcedureContract<TRootContext, TInput, TOutput, TDefinitions, "mutation">
    | Procedure<TRootContext, TInput, TOutput, TDefinitions, "mutation"> {
    return handler === undefined
      ? this.finishContract("mutation")
      : this.finish("mutation", handler);
  }

  subscription(): ProcedureContract<TRootContext, TInput, TOutput, TDefinitions, "subscription"> {
    return this.finishContract("subscription");
  }

  private finishContract<TKind extends "query" | "mutation" | "subscription">(
    kind: TKind,
  ): ProcedureContract<TRootContext, TInput, TOutput, TDefinitions, TKind> {
    if (!this.outputCodec) {
      throw new TypeError("A procedure requires an output codec");
    }
    this.assertAffectsAllowed(kind);
    return Object.freeze({
      _kind: "procedure-contract" as const,
      _def: Object.freeze({
        kind,
        input: this.inputCodec ?? (wire.object({}) as WireCodec<TInput, WireValue>),
        output: this.outputCodec,
        definitions: this.definitions,
        ...(this.affectsEntries.length === 0 ? {} : { affects: this.affectsEntries }),
        ...(this.writesEntries.length === 0 ? {} : { writes: this.writesEntries }),
      }),
    });
  }

  private assertAffectsAllowed(kind: string): void {
    if (this.affectsEntries.length > 0 && kind !== "mutation") {
      throw new TypeError("Only mutations declare .affects(); queries are invalidated, not invalidating");
    }
    if (this.writesEntries.length > 0 && kind !== "mutation") {
      throw new TypeError("Only mutations declare .writes()");
    }
  }

  private finish<TKind extends "query" | "mutation">(
    kind: TKind,
    handler: (
      args: ProcedureHandlerArgs<TContext, TInput, TDefinitions>,
    ) => MaybePromise<Result<TOutput, ErrorUnion<TDefinitions>>>,
  ): Procedure<TRootContext, TInput, TOutput, TDefinitions, TKind> {
    if (!this.outputCodec) {
      throw new TypeError("A procedure requires an output codec");
    }
    this.assertAffectsAllowed(kind);
    return Object.freeze({
      _kind: "procedure" as const,
      _def: Object.freeze({
        kind,
        input: this.inputCodec ?? (wire.object({}) as WireCodec<TInput, WireValue>),
        output: this.outputCodec,
        definitions: this.definitions,
        ...(this.affectsEntries.length === 0 ? {} : { affects: this.affectsEntries }),
        ...(this.writesEntries.length === 0 ? {} : { writes: this.writesEntries }),
        middlewares: this.middlewares,
        handler: handler as ProcedureManifest<TRootContext, TInput, TOutput, TDefinitions>["handler"],
      }),
    });
  }
}

export class ProcedureImplementer<
  TRootContext,
  TContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
  TKind extends "query" | "mutation" | "subscription" = "query" | "mutation" | "subscription",
> {
  constructor(
    private readonly contract: ProcedureContract<
      TRootContext,
      TInput,
      TOutput,
      TDefinitions,
      TKind
    >,
    private readonly middlewares: readonly RuntimeMiddleware[] = [],
  ) {}

  use<TOutputContext, TMiddlewareDefinitions extends ErrorDefinitionMap>(
    middleware: Middleware<TContext, TOutputContext, TMiddlewareDefinitions>,
  ): ProcedureImplementer<TRootContext, TOutputContext, TInput, TOutput, TDefinitions, TKind> {
    assertDefinitionsAreDeclared(this.contract._def.definitions, middleware.definitions);
    return new ProcedureImplementer(
      this.contract,
      appendMiddleware(this.middlewares, middleware as unknown as RuntimeMiddleware),
    );
  }

  handler(
    this: ProcedureImplementer<TRootContext, TContext, TInput, TOutput, TDefinitions, "query" | "mutation">,
    handler: (
      args: ProcedureHandlerArgs<TContext, TInput, TDefinitions>,
    ) => MaybePromise<Result<TOutput, ErrorUnion<TDefinitions>>>,
  ): Procedure<TRootContext, TInput, TOutput, TDefinitions, "query" | "mutation"> {
    return Object.freeze({
      _kind: "procedure" as const,
      _def: Object.freeze({
        ...this.contract._def,
        middlewares: this.middlewares,
        handler: handler as ProcedureManifest<
          TRootContext,
          TInput,
          TOutput,
          TDefinitions
        >["handler"],
      }),
    });
  }

  stream(
    this: ProcedureImplementer<TRootContext, TContext, TInput, TOutput, TDefinitions, "subscription">,
    handler: (
      args: ProcedureHandlerArgs<TContext, TInput, TDefinitions>,
    ) => MaybePromise<AsyncIterable<Result<TOutput, ErrorUnion<TDefinitions>>>>,
  ): SubscriptionProcedure<TRootContext, TInput, TOutput, TDefinitions> {
    return Object.freeze({
      _kind: "subscription-procedure" as const,
      _def: Object.freeze({
        ...this.contract._def,
        kind: "subscription" as const,
        middlewares: this.middlewares,
        handler: handler as SubscriptionProcedureManifest<
          TRootContext,
          TInput,
          TOutput,
          TDefinitions
        >["handler"],
      }),
    });
  }
}

export interface RouterRecord {
  readonly [key: string]: AnyProcedure | RouterRecord;
}

export interface ContractRouterRecord {
  readonly [key: string]: AnyProcedureContract | ContractRouterRecord;
}

export interface RouterContract<TRootContext, TRecord extends ContractRouterRecord> {
  readonly _kind: "router-contract";
  readonly record: TRecord;
  readonly procedures: ReadonlyMap<string, AnyProcedureContract>;
  /** The application error registry: every declared tag, exactly one definition each. */
  readonly errors: ReadonlyMap<string, AnyErrorDefinition>;
  readonly _rootContext?: TRootContext;
}

export interface Router<TRootContext, TRecord extends RouterRecord> {
  readonly _kind: "router";
  readonly record: TRecord;
  readonly procedures: ReadonlyMap<string, AnyProcedure>;
  /** The application error registry: every declared tag, exactly one definition each. */
  readonly errors: ReadonlyMap<string, AnyErrorDefinition>;
  readonly _rootContext?: TRootContext;
}


/**
 * The router is the error registry: one tag maps to exactly one definition
 * across the whole application. This is what makes tags safe as global
 * identities — shells claim ambiently by tag alone, so two procedures reusing
 * a tag must share the definition (same reference), never redeclare it.
 */
const collectErrorRegistry = (
  procedures: ReadonlyMap<string, { readonly _def: { readonly definitions: ErrorDefinitionMap } }>,
): ReadonlyMap<string, AnyErrorDefinition> => {
  const byTag = new Map<string, AnyErrorDefinition>();
  const firstSeen = new Map<string, string>();
  for (const [path, procedure] of procedures) {
    for (const definition of Object.values(procedure._def.definitions)) {
      const existing = byTag.get(definition.tag);
      if (existing && existing !== definition) {
        throw new TypeError(
          `Error tag ${definition.tag} has conflicting definitions in ${firstSeen.get(definition.tag)} and ${path}; share one definition instead of redeclaring the tag`,
        );
      }
      if (!existing) {
        byTag.set(definition.tag, definition);
        firstSeen.set(definition.tag, path);
      }
    }
  }
  return byTag;
};

const createRouter = <TRootContext, const TRecord extends RouterRecord>(
  record: TRecord,
): Router<TRootContext, TRecord> => {
  const procedures = new Map<string, AnyProcedure>();
  const isProcedure = (value: AnyProcedure | RouterRecord): value is AnyProcedure =>
    "_kind" in value
    && (value._kind === "procedure" || value._kind === "subscription-procedure");
  const visit = (node: RouterRecord, prefix: readonly string[]) => {
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key];
      if (isProcedure(value)) procedures.set(path.join("."), value);
      else visit(value, path);
    }
  };
  visit(record, []);
  const errors = collectErrorRegistry(procedures);
  return Object.freeze({ _kind: "router" as const, record, procedures, errors });
};

const RESERVED_CONTRACT_KEYS = new Set(["_kind", "record", "procedures", "errors", "_rootContext"]);

const createRouterContract = <
  TRootContext,
  const TRecord extends ContractRouterRecord,
>(record: TRecord): RouterContract<TRootContext, TRecord> & TRecord => {
  const procedures = new Map<string, AnyProcedureContract>();
  const isProcedureContract = (
    value: AnyProcedureContract | ContractRouterRecord,
  ): value is AnyProcedureContract =>
    "_kind" in value && value._kind === "procedure-contract";
  const visit = (node: ContractRouterRecord, prefix: readonly string[]) => {
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key];
      if (isProcedureContract(value)) procedures.set(path.join("."), value);
      else visit(value, path);
    }
  };
  visit(record, []);
  for (const key of Object.keys(record)) {
    if (RESERVED_CONTRACT_KEYS.has(key)) {
      throw new TypeError(`Contract key ${key} collides with a reserved property`);
    }
  }
  const errors = collectErrorRegistry(procedures);
  // Entries are spread onto the contract so call sites read
  // `app.implement(contract.list)` rather than `contract.record.list`.
  return Object.freeze({
    ...record,
    _kind: "router-contract" as const,
    record,
    procedures,
    errors,
  }) as RouterContract<TRootContext, TRecord> & TRecord;
};

export interface RpcFactory<TRootContext> {
  procedure(): ProcedureBuilder<TRootContext>;
  middleware<TAddedContext = {}>(): MiddlewareBuilder<TRootContext, TAddedContext>;
  router<const TRecord extends RouterRecord>(record: TRecord): Router<TRootContext, TRecord>;
  contract<const TRecord extends ContractRouterRecord>(
    record: TRecord,
  ): RouterContract<TRootContext, TRecord> & TRecord;
  implement<
    TInput,
    TOutput,
    TDefinitions extends ErrorDefinitionMap,
    TKind extends "query" | "mutation" | "subscription",
  >(
    contract: ProcedureContract<TRootContext, TInput, TOutput, TDefinitions, TKind>,
  ): ProcedureImplementer<TRootContext, TRootContext, TInput, TOutput, TDefinitions, TKind>;
}

const factory = <TRootContext>(): RpcFactory<TRootContext> => ({
  procedure: () => new ProcedureBuilder<TRootContext>(),
  middleware: <TAddedContext = {}>() =>
    new MiddlewareBuilder<TRootContext, TAddedContext>(),
  router: (record) => createRouter<TRootContext, typeof record>(record),
  contract: (record) => createRouterContract<TRootContext, typeof record>(record),
  implement: (contract) => new ProcedureImplementer(contract),
});

export const rpc = Object.assign(factory<unknown>(), {
  context: <TRootContext>() => factory<TRootContext>(),
});

export const assertDefinitionsCanMerge = (
  left: ErrorDefinitionMap,
  right: ErrorDefinitionMap,
): void => {
  const byTag = new Map<string, AnyErrorDefinition>();
  for (const definition of Object.values(left)) byTag.set(definition.tag, definition);
  for (const definition of Object.values(right)) {
    const existing = byTag.get(definition.tag);
    if (existing && existing !== definition) {
      throw new TypeError(`Conflicting definitions for error tag ${definition.tag}`);
    }
    byTag.set(definition.tag, definition);
  }
};

export const assertDefinitionsAreDeclared = (
  declared: ErrorDefinitionMap,
  contributed: ErrorDefinitionMap,
): void => {
  const declaredByTag = new Map(
    Object.values(declared).map((definition) => [definition.tag, definition] as const),
  );
  for (const definition of Object.values(contributed)) {
    if (declaredByTag.get(definition.tag) !== definition) {
      throw new TypeError(
        `Middleware error ${definition.tag} is not declared by the procedure contract`,
      );
    }
  }
};

const incidentId = (): string => `inc_${crypto.randomUUID()}`;


/** Malformed input is the client's fault: a 400 with path-only issues, no incident. */
const badInputFailure = (
  cause: unknown,
): Result<never, ReturnType<typeof ServerBadRequest>> => err(badRequestFromIssues(cause));

const internalFailure = (
  phase: InternalErrorEvent["phase"],
  cause: unknown,
  options: ExecutionOptions<unknown>,
): Result<never, ReturnType<typeof ServerInternal>> => {
  const id = incidentId();
  options.onInternalError?.({
    incidentId: id,
    phase,
    cause,
    ...(options.procedurePath === undefined ? {} : { procedurePath: options.procedurePath }),
  });
  return err(ServerInternal({ incidentId: id }));
};

export const executeProcedure = async <
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
>(
  procedure: Procedure<TRootContext, TInput, TOutput, TDefinitions>,
  input: TInput,
  options: ExecutionOptions<TRootContext>,
): Promise<Result<TOutput, ErrorUnion<TDefinitions> | ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest>>> => {
  let decodedInput: ReturnType<typeof procedure._def.input.decode>;
  try {
    const encodedInput = procedure._def.input.encode(input);
    if (!encodedInput.ok) return badInputFailure(encodedInput.issues);
    decodedInput = procedure._def.input.decode(encodedInput.value);
    if (!decodedInput.ok) return badInputFailure(decodedInput.issues);
  } catch (cause) {
    return internalFailure("input", cause, options);
  }

  const dispatch = async (
    index: number,
    context: unknown,
  ): Promise<Result<unknown, AnyTaggedError>> => {
    const middleware = procedure._def.middlewares[index];
    if (middleware) {
      try {
        return await middleware.handler({
          context,
          errors: middleware.definitions,
          next: ({ context: nextContext }) => dispatch(index + 1, nextContext),
        });
      } catch (cause) {
        return internalFailure("middleware", cause, options);
      }
    }
    try {
      return await procedure._def.handler({
        context,
        input: decodedInput.value,
        errors: procedure._def.definitions,
      });
    } catch (cause) {
      return internalFailure("handler", cause, options);
    }
  };

  const result = await dispatch(0, options.context);
  if (
    result === null
    || typeof result !== "object"
    || !("ok" in result)
    || typeof result.ok !== "boolean"
  ) return internalFailure("handler", result, options);
  if (result.ok) {
    try {
      const encoded = procedure._def.output.encode(result.value as TOutput);
      if (!encoded.ok) return internalFailure("output", encoded.issues, options);
      const decoded = procedure._def.output.decode(encoded.value);
      if (!decoded.ok) return internalFailure("output", decoded.issues, options);
      return { ok: true, value: decoded.value };
    } catch (cause) {
      return internalFailure("output", cause, options);
    }
  }

  if (
    result.error === null
    || typeof result.error !== "object"
    || !("_tag" in result.error)
    || typeof result.error._tag !== "string"
  ) return internalFailure("error", result.error, options);
  if (ServerInternal.is(result.error)) {
    const decodedInternal = ServerInternal.decode(result.error);
    return decodedInternal.ok
      ? err(decodedInternal.value)
      : internalFailure("error", result.error, options);
  }
  let normalizedError: AnyTaggedError;
  try {
    const definition = Object.values(procedure._def.definitions).find(
      (candidate) => candidate.tag === result.error._tag,
    );
    if (!definition || definition.policy.visibility !== "public") {
      return internalFailure("error", result.error, options);
    }
    const decoded = definition.decode(result.error);
    if (!decoded.ok) return internalFailure("error", result.error, options);
    normalizedError = decoded.value;
  } catch (cause) {
    return internalFailure("error", cause, options);
  }
  return err(normalizedError as ErrorUnion<TDefinitions>);
};

export async function* executeSubscription<
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
>(
  procedure: SubscriptionProcedure<TRootContext, TInput, TOutput, TDefinitions>,
  input: TInput,
  options: ExecutionOptions<TRootContext>,
): AsyncGenerator<Result<TOutput, ErrorUnion<TDefinitions> | ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest>>> {
  const encodedInput = procedure._def.input.encode(input);
  if (!encodedInput.ok) {
    yield badInputFailure(encodedInput.issues);
    return;
  }
  const decodedInput = procedure._def.input.decode(encodedInput.value);
  if (!decodedInput.ok) {
    yield badInputFailure(decodedInput.issues);
    return;
  }

  const prepareContext = async (
    index: number,
    context: unknown,
  ): Promise<Result<unknown, AnyTaggedError>> => {
    const middleware = procedure._def.middlewares[index];
    if (!middleware) return { ok: true, value: context };
    try {
      return await middleware.handler({
        context,
        errors: middleware.definitions,
        next: ({ context: nextContext }) => prepareContext(index + 1, nextContext),
      });
    } catch (cause) {
      return internalFailure("middleware", cause, options);
    }
  };

  const prepared = await prepareContext(0, options.context);
  if (!prepared.ok) {
    if (ServerInternal.is(prepared.error)) {
      const decoded = ServerInternal.decode(prepared.error);
      yield decoded.ok
        ? err(decoded.value)
        : internalFailure("error", prepared.error, options);
    }
    else {
      const definition = Object.values(procedure._def.definitions).find(
        (candidate) => candidate.tag === prepared.error._tag,
      );
      const decoded = definition?.policy.visibility === "public"
        ? definition.decode(prepared.error)
        : undefined;
      yield decoded?.ok
        ? err(decoded.value as ErrorUnion<TDefinitions>)
        : internalFailure("error", prepared.error, options);
    }
    return;
  }

  let iterable: AsyncIterable<Result<TOutput, ErrorUnion<TDefinitions>>>;
  try {
    iterable = await procedure._def.handler({
      context: prepared.value,
      input: decodedInput.value,
      errors: procedure._def.definitions,
    });
  } catch (cause) {
    yield internalFailure("handler", cause, options);
    return;
  }

  try {
    for await (const result of iterable) {
      if (result.ok) {
        const encoded = procedure._def.output.encode(result.value);
        if (!encoded.ok) {
          yield internalFailure("output", encoded.issues, options);
          return;
        }
        const decoded = procedure._def.output.decode(encoded.value);
        if (!decoded.ok) {
          yield internalFailure("output", decoded.issues, options);
          return;
        }
        yield ok(decoded.value);
        continue;
      }
      const definition = Object.values(procedure._def.definitions).find(
        (candidate) => candidate.tag === result.error._tag,
      );
      const decoded = definition?.policy.visibility === "public"
        ? definition.decode(result.error)
        : undefined;
      if (!decoded?.ok) {
        yield internalFailure("error", result.error, options);
      } else {
        yield err(decoded.value as ErrorUnion<TDefinitions>);
      }
      return;
    }
  } catch (cause) {
    yield internalFailure("handler", cause, options);
  }
}

export type ProcedureInput<TProcedure> = TProcedure extends { readonly _def: ProcedureContractManifest<any, infer TInput, any, any, any> }
  ? TInput
  : never;
export type ProcedureOutput<TProcedure> = TProcedure extends { readonly _def: ProcedureContractManifest<any, any, infer TOutput, any, any> }
  ? TOutput
  : never;
export type ProcedureError<TProcedure> = TProcedure extends { readonly _def: ProcedureContractManifest<any, any, any, infer TDefinitions, any> }
  ? ErrorUnion<TDefinitions>
  : never;
export type RouterContext<TRouter> = TRouter extends Router<infer TContext, RouterRecord>
  ? TContext
  : never;

type RouterRecordOf<TRouter> = TRouter extends Router<any, infer TRecord>
  ? TRecord
  : TRouter extends RouterContract<any, infer TRecord>
    ? TRecord
    : never;

type HasDef = { readonly _def: ProcedureContractManifest<any, any, any, any, any> };

type MapRecord<TRecord, TProject> = {
  readonly [TKey in keyof TRecord]: TRecord[TKey] extends HasDef
    ? TProject extends "input"
      ? ProcedureInput<TRecord[TKey]>
      : TProject extends "output"
        ? ProcedureOutput<TRecord[TKey]>
        : ProcedureError<TRecord[TKey]>
    : MapRecord<TRecord[TKey], TProject>;
};

/**
 * Nested input types for a router or contract, mirroring its shape:
 *
 *     type Inputs = RouterInputs<typeof appRouter>
 *     type RenameInput = Inputs["trip"]["rename"]
 */
export type RouterInputs<TRouter> = MapRecord<RouterRecordOf<TRouter>, "input">;
/** Nested success-value types, mirroring the router's shape. */
export type RouterOutputs<TRouter> = MapRecord<RouterRecordOf<TRouter>, "output">;
/** Nested declared-error unions (server view; client boundary tags not included). */
export type RouterErrors<TRouter> = MapRecord<RouterRecordOf<TRouter>, "errors">;

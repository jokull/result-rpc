import { isTaggedError, type AnyPublicErrorDefinition, type AnyTaggedError } from "../error.js";
import type { RpcFactoryTypeCarrier, RpcFactoryTypes } from "../factory-types.js";
import {
  mergeDefinitionMaps,
  type DefinitionMapCompatibility,
  type DefinitionSourcesCompatibility,
  type ErrorDefinitionMap,
  type ErrorUnion,
  type MaterializeDefinitionSources,
  type MergeDefinitionMaps,
  type MergeDefinitionSources,
} from "../error-map.js";
import { badRequestFromIssues, ServerBadRequest, ServerInternal } from "../framework-errors.js";
import { entityIdFor, entityKey, type AnyModel, type ModelKeyInput } from "../model.js";
import { closeIterator } from "../iterator.js";
import {
  PaginatedProcedureCapability,
  type ProcedureCapability,
  type UnaryProcedureCapability,
} from "../procedure-capability.js";
import { procedureDeclaration, type ProcedureDeclaration } from "../procedure-declaration.js";
import type {
  AffectsEntry,
  AnyProcedureContract,
  AnyProcedureTypes,
  CompleteProcedureTypes,
  Page,
  PageRequest,
  PaginationManifest,
  ProcedureAffectsInput,
  ProcedureContract,
  ProcedureContractManifest,
  ProcedureError,
  ProcedureInput,
  ProcedureInputConstraint,
  ProcedureKind,
  ProcedureOutput,
  ProcedureTypeCarrier,
  ProcedureTerminalConstraint,
  ProcedureTypes,
  ProcedureTypesOf,
  QueryAffectsTarget,
  WithProcedureDefinitions,
  WithProcedureHeaders,
  WithProcedureResumable,
  WithProcedureInput,
  WithProcedureKinds,
  WithProcedureMappedInput,
  WithProcedureMiddleware,
  WithProcedureOutput,
  WritesEntry,
} from "../procedure-types.js";
import { err, ok, type Result } from "../result.js";
import type { RpcConstraintError } from "../type-diagnostics.js";
import { encodeProcedureInput, encodeUnknownWireValue, wire } from "../wire.js";
import type { EmptyObject, WireCodec, WireValue } from "../wire.js";

export type { ErrorDefinitionMap, ErrorUnion, MergeDefinitionMaps } from "../error-map.js";
export {
  PaginatedProcedureCapability,
  type ProcedureCapability,
  type UnaryProcedureCapability,
} from "../procedure-capability.js";
export type {
  AffectsEntry,
  AnyProcedureContract,
  AnyProcedureTypes,
  CompleteProcedureTypes,
  Page,
  PageRequest,
  PaginationManifest,
  ProcedureAffectsInput,
  ProcedureContract,
  ProcedureContractManifest,
  ProcedureInputConstraint,
  ProcedureInput,
  ProcedureKind,
  ProcedureOutput,
  ProcedureError,
  ProcedureTypeCarrier,
  ProcedureTerminalConstraint,
  ProcedureTypes,
  ProcedureTypesOf,
  QueryAffectsTarget,
  WithProcedureContext,
  WithProcedureDefinitions,
  WithProcedureHeaders,
  WithProcedureInput,
  WithProcedureKinds,
  WithProcedureMappedInput,
  WithProcedureMiddleware,
  WithProcedureOutput,
  WithProcedureResumable,
  WritesEntry,
} from "../procedure-types.js";
import type { MaybePromise } from "../types.js";
export type BooleanOr<TLeft extends boolean, TRight extends boolean> = TLeft extends true
  ? true
  : TRight extends true
    ? true
    : false;

function booleanOr<TLeft extends boolean, TRight extends boolean>(
  left: TLeft,
  right: TRight,
): BooleanOr<TLeft, TRight>;
function booleanOr(left: boolean, right: boolean): boolean {
  return left || right;
}

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
  /** Receives `model:id` keys the handler declared via `touch()`. */
  readonly onTouch?: (entityKey: string) => void;
  /**
   * Aborts when the caller is gone — the request aborted, the client
   * disconnected from a stream. Handlers pass it to their own IO so
   * in-flight work stops with the caller.
   */
  readonly signal?: AbortSignal;
  /**
   * The response's headers. Reaches `context.headers` only for procedures that
   * declared `.headers()`; every other procedure never sees it, which is what
   * makes the declaration enforceable rather than advisory.
   */
  readonly responseHeaders?: Headers;
  /**
   * The resume point a reconnecting client observed, delivered to a
   * `.resumable()` subscription handler as `lastEventId`.
   */
  readonly lastEventId?: string;
}

/**
 * Fallback for executions with no caller lifetime (tests, jobs). Created on
 * first use because Workers forbid constructing runtime I/O primitives during
 * module initialization.
 */
let detachedSignal: AbortSignal | undefined;
const neverAborted = (): AbortSignal => {
  detachedSignal ??= new AbortController().signal;
  return detachedSignal;
};

const touchedEntityKey = <TModel extends AnyModel>(
  model: TModel,
  id: ModelKeyInput<TModel>,
): string => {
  const resolved = entityIdFor(model, id);
  if (resolved === undefined) {
    throw new TypeError(`Entity key for ${model.name} is missing key fields`);
  }
  return entityKey(model.name, resolved);
};

/**
 * Adds `headers` to the context for procedures that declared `.headers()`.
 * Callers with no response to write to (the direct server caller, tests) get a
 * detached `Headers`: the writes are inert, like cache declarations there.
 */
const contextWithHeaders = (
  context: unknown,
  procedure: { readonly _def: { readonly writesHeaders?: true } },
  options: { readonly responseHeaders?: Headers },
): unknown =>
  procedure._def.writesHeaders !== true
    ? context
    : {
        ...(context !== null && typeof context === "object" ? context : {}),
        headers: options.responseHeaders ?? new Headers(),
      };

declare const middlewareNextResult: unique symbol;
export type MiddlewareNextResult = Result<unknown, AnyTaggedError> & {
  readonly [middlewareNextResult]: true;
};

export interface MiddlewareNext<TContribution> {
  (options: { readonly context: TContribution }): Promise<MiddlewareNextResult>;
}

export interface MiddlewareHandlerArgs<
  TInputContext,
  TContribution,
  TDefinitionSources extends ErrorDefinitionMap,
> {
  readonly context: TInputContext;
  readonly errors: MaterializeDefinitionSources<TDefinitionSources>;
  readonly next: MiddlewareNext<TContribution>;
}

export type MiddlewareHandler<
  TInputContext,
  TContribution,
  TDefinitionSources extends ErrorDefinitionMap,
> = (
  args: MiddlewareHandlerArgs<TInputContext, TContribution, TDefinitionSources>,
) => MaybePromise<Result<unknown, ErrorUnion<TDefinitionSources>> | MiddlewareNextResult>;

export type ErasedMiddlewareHandler = (args: {
  readonly context: unknown;
  readonly errors: ErrorDefinitionMap;
  readonly next: (options: {
    readonly context: unknown;
  }) => Promise<Result<unknown, AnyTaggedError>>;
}) => MaybePromise<Result<unknown, AnyTaggedError>>;

export interface RuntimeMiddleware {
  /** Definitions this middleware's handler may construct. */
  readonly ownDefinitions: ErrorDefinitionMap;
  /** Definitions contributed by this middleware and its dependency graph. */
  readonly definitions: ErrorDefinitionMap;
  readonly handler: ErasedMiddlewareHandler;
  /** Middleware this one depends on; flattened and deduped at `.use()` time. */
  readonly requires: readonly RuntimeMiddleware[];
  /** Set by `.headers()`; forces every procedure using it to declare the same. */
  readonly writesHeaders?: boolean;
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

const mergeMiddlewareContext = (context: unknown, contribution: unknown): object => {
  if (typeof context !== "object" || context === null) {
    throw new TypeError("Middleware context must be a non-null object");
  }
  if (typeof contribution !== "object" || contribution === null) {
    throw new TypeError("Middleware context contribution must be a non-null object");
  }
  return { ...context, ...contribution };
};

export interface MiddlewareTypes<
  TInputContext,
  TOutputContext,
  TDefinitionSources extends ErrorDefinitionMap,
  TDependencies extends readonly AnyMiddlewareTypes[] = readonly [],
  TWritesHeaders extends boolean = false,
  TProvidedContext = TOutputContext,
  TOwnDefinitionSources extends ErrorDefinitionMap = TDefinitionSources,
> {
  readonly inputContext: TInputContext;
  readonly outputContext: TOutputContext;
  readonly definitionSources: TDefinitionSources;
  readonly ownDefinitionSources: TOwnDefinitionSources;
  readonly dependencies: TDependencies;
  readonly writesHeaders: TWritesHeaders;
  /** Context contributed by this dependency graph, excluding its outer input. */
  readonly providedContext: TProvidedContext;
}

/** Runtime-erased middleware facts. Specific associated records remain assignable. */
export interface AnyMiddlewareTypes {
  readonly inputContext: unknown;
  readonly outputContext: unknown;
  readonly definitionSources: ErrorDefinitionMap;
  readonly ownDefinitionSources: ErrorDefinitionMap;
  readonly dependencies: readonly AnyMiddlewareTypes[];
  readonly writesHeaders: boolean;
  readonly providedContext: unknown;
}

export interface Middleware<TTypes extends AnyMiddlewareTypes> {
  readonly _kind: "middleware";
  readonly ownDefinitions: MaterializeDefinitionSources<TTypes["ownDefinitionSources"]>;
  readonly definitions: MaterializeDefinitionSources<TTypes["definitionSources"]>;
  readonly handler: ErasedMiddlewareHandler;
  readonly requires: readonly RuntimeMiddleware[];
  readonly writesHeaders: TTypes["writesHeaders"];
  readonly _types?: {
    /** Contravariant: a middleware needing less context works with more. */
    readonly inputContext: (context: TTypes["inputContext"]) => void;
    readonly outputContext: TTypes["outputContext"];
    readonly error: ErrorUnion<TTypes["definitionSources"]>;
    readonly ownError: ErrorUnion<TTypes["ownDefinitionSources"]>;
    readonly dependencies: TTypes["dependencies"];
    readonly writesHeaders: TTypes["writesHeaders"];
    readonly providedContext: TTypes["providedContext"];
  };
}

/** Runtime-erased middleware accepted by composition points. */
export interface AnyMiddleware {
  readonly _kind: "middleware";
  readonly ownDefinitions: ErrorDefinitionMap;
  readonly definitions: ErrorDefinitionMap;
  readonly handler: ErasedMiddlewareHandler;
  readonly requires: readonly RuntimeMiddleware[];
  readonly writesHeaders: boolean;
  readonly _types?: unknown;
}

export type MiddlewareTypesOf<TMiddleware> =
  TMiddleware extends Middleware<infer TTypes> ? TTypes : never;

/**
 * One immediate dependency edge. Its own ancestry is a runtime graph fact and
 * is deliberately not copied recursively into every downstream type record.
 */
export type MiddlewareDependencyTypes<TTypes extends AnyMiddlewareTypes> = MiddlewareTypes<
  TTypes["inputContext"],
  TTypes["outputContext"],
  TTypes["definitionSources"],
  readonly [],
  TTypes["writesHeaders"],
  TTypes["providedContext"],
  TTypes["ownDefinitionSources"]
>;

/** Construction state for a middleware before its handler closes the builder. */
export interface MiddlewareBuilderTypes<
  TInputContext,
  TContext,
  TAddedContext,
  TDefinitionSources extends ErrorDefinitionMap,
  TDependencies extends readonly AnyMiddlewareTypes[] = readonly [],
  TWritesHeaders extends boolean = false,
  TProvidedContext = {},
  TOwnDefinitionSources extends ErrorDefinitionMap = never,
> {
  /** Context required by the complete dependency chain. */
  readonly inputContext: TInputContext;
  /** Context visible to this middleware's handler after dependencies run. */
  readonly context: TContext;
  /** Context this middleware promises to add when it calls `next`. */
  readonly addedContext: TAddedContext;
  readonly definitionSources: TDefinitionSources;
  readonly ownDefinitionSources: TOwnDefinitionSources;
  readonly dependencies: TDependencies;
  readonly writesHeaders: TWritesHeaders;
  /** Contributions accumulated from `.after()` dependencies. */
  readonly providedContext: TProvidedContext;
}

export interface AnyMiddlewareBuilderTypes {
  readonly inputContext: unknown;
  readonly context: unknown;
  readonly addedContext: unknown;
  readonly definitionSources: ErrorDefinitionMap;
  readonly ownDefinitionSources: ErrorDefinitionMap;
  readonly dependencies: readonly AnyMiddlewareTypes[];
  readonly writesHeaders: boolean;
  readonly providedContext: unknown;
}

export type WithMiddlewareDefinitions<
  TTypes extends AnyMiddlewareBuilderTypes,
  TNewDefinitions extends ErrorDefinitionMap,
> = MiddlewareBuilderTypes<
  TTypes["inputContext"],
  TTypes["context"],
  TTypes["addedContext"],
  MergeDefinitionSources<TTypes["definitionSources"], TNewDefinitions>,
  TTypes["dependencies"],
  TTypes["writesHeaders"],
  TTypes["providedContext"],
  MergeDefinitionSources<TTypes["ownDefinitionSources"], TNewDefinitions>
>;

export type WithMiddlewareHeaders<TTypes extends AnyMiddlewareBuilderTypes> =
  MiddlewareBuilderTypes<
    TTypes["inputContext"],
    TTypes["context"] & { readonly headers: Headers },
    TTypes["addedContext"],
    TTypes["definitionSources"],
    TTypes["dependencies"],
    true,
    TTypes["providedContext"] & { readonly headers: Headers },
    TTypes["ownDefinitionSources"]
  >;

export type WithMiddlewareDependency<
  TTypes extends AnyMiddlewareBuilderTypes,
  TDependency extends AnyMiddlewareTypes,
> = MiddlewareBuilderTypes<
  TTypes["inputContext"],
  TTypes["context"] & TDependency["providedContext"],
  TTypes["addedContext"],
  MergeDefinitionSources<TTypes["definitionSources"], TDependency["definitionSources"]>,
  readonly [...TTypes["dependencies"], MiddlewareDependencyTypes<TDependency>],
  BooleanOr<TTypes["writesHeaders"], TDependency["writesHeaders"]>,
  TTypes["providedContext"] & TDependency["providedContext"],
  TTypes["ownDefinitionSources"]
>;

export type CompleteMiddlewareTypes<TTypes extends AnyMiddlewareBuilderTypes> = MiddlewareTypes<
  TTypes["inputContext"],
  TTypes["inputContext"] & TTypes["providedContext"] & TTypes["addedContext"],
  TTypes["definitionSources"],
  TTypes["dependencies"],
  TTypes["writesHeaders"],
  TTypes["providedContext"] & TTypes["addedContext"],
  TTypes["ownDefinitionSources"]
>;

export type MiddlewareContextCompatibility<TAvailable, TRequired> = [TAvailable] extends [TRequired]
  ? unknown
  : RpcConstraintError<
      "middleware-requires-incompatible-context",
      { readonly available: TAvailable; readonly required: TRequired }
    >;

export class MiddlewareBuilder<TTypes extends AnyMiddlewareBuilderTypes> {
  constructor(
    private readonly definitions: ErrorDefinitionMap = {},
    private readonly ownDefinitions: ErrorDefinitionMap = {},
    private readonly dependencies: readonly RuntimeMiddleware[] = [],
    private readonly declaresHeaders: boolean = false,
  ) {}

  errors<const TNewDefinitions extends ErrorDefinitionMap>(
    definitions: TNewDefinitions &
      DefinitionSourcesCompatibility<TTypes["definitionSources"], NoInfer<TNewDefinitions>>,
  ): MiddlewareBuilder<WithMiddlewareDefinitions<TTypes, TNewDefinitions>> {
    return new MiddlewareBuilder<WithMiddlewareDefinitions<TTypes, TNewDefinitions>>(
      mergeDefinitionMaps(this.definitions, definitions),
      mergeDefinitionMaps(this.ownDefinitions, definitions),
      this.dependencies,
      this.declaresHeaders,
    );
  }

  /**
   * Declares that this middleware writes response headers — a rotated session
   * cookie, a rate-limit header. Adds `context.headers` for the handler, and
   * every procedure that `.use()`s it must declare `.headers()` too, exactly
   * as it must pre-declare the middleware's errors.
   */
  headers(): MiddlewareBuilder<WithMiddlewareHeaders<TTypes>> {
    return new MiddlewareBuilder<WithMiddlewareHeaders<TTypes>>(
      this.definitions,
      this.ownDefinitions,
      this.dependencies,
      true,
    );
  }

  /**
   * Declares a middleware this one depends on. The handler's input context
   * becomes the dependency's output context, the dependency's errors join this
   * middleware's union, and any `.use()` site pulls the dependency in
   * automatically — deduplicated by reference when several middleware share it.
   */
  after<TDependencyTypes extends AnyMiddlewareTypes>(
    dependency: Middleware<TDependencyTypes> &
      MiddlewareContextCompatibility<TTypes["context"], TDependencyTypes["inputContext"]>,
  ): MiddlewareBuilder<WithMiddlewareDependency<TTypes, TDependencyTypes>> {
    return new MiddlewareBuilder<WithMiddlewareDependency<TTypes, TDependencyTypes>>(
      mergeDefinitionMaps(this.definitions, dependency.definitions),
      this.ownDefinitions,
      [...this.dependencies, dependency],
      // A dependency that writes headers makes this one a header writer too:
      // `.use()` sites pull it in, so the obligation has to travel with it.
      booleanOr(this.declaresHeaders, dependency.writesHeaders),
    );
  }

  use(
    handler: MiddlewareHandler<
      TTypes["context"],
      TTypes["addedContext"],
      TTypes["ownDefinitionSources"]
    >,
  ): Middleware<CompleteMiddlewareTypes<TTypes>> {
    // Audited middleware compile boundary: the fluent transitions above are
    // the sole writers of these maps and the associated source records.
    return Object.freeze({
      _kind: "middleware" as const,
      ownDefinitions: this.ownDefinitions,
      definitions: this.definitions,
      handler: handler as ErasedMiddlewareHandler,
      requires: this.dependencies,
      writesHeaders: this.declaresHeaders,
    }) as Middleware<CompleteMiddlewareTypes<TTypes>>;
  }
}

/**
 * A subscription handler's arguments. `lastEventId` is the resume point the
 * client observed before this connection: `undefined` on a first connect, on
 * every reconnect of a procedure that did not declare `.resumable()`, and
 * whenever the client has not yet seen an event to derive one from.
 */
export interface SubscriptionHandlerArgs<
  TContext,
  TInput,
  TDefinitions extends ErrorDefinitionMap,
> extends ProcedureHandlerArgs<TContext, TInput, TDefinitions> {
  readonly lastEventId: string | undefined;
}

export interface ProcedureHandlerArgs<TContext, TInput, TDefinitions extends ErrorDefinitionMap> {
  readonly context: TContext;
  readonly input: TInput;
  readonly errors: TDefinitions;
  /**
   * Declares an entity this handler wrote that its output does not carry —
   * cascades, side-effect writes, deletes. Rides the response envelope as
   * `model:id` keys (never values) and invalidates by identity client-side.
   */
  readonly touch: <TModel extends AnyModel>(model: TModel, id: ModelKeyInput<TModel>) => void;
  /**
   * Aborts when the caller is gone — the HTTP request aborted, or the
   * client disconnected from a subscription stream. Pass it to fetch/db
   * calls so abandoned work stops; never aborted in environments that
   * cannot observe disconnects.
   */
  readonly signal: AbortSignal;
}

export type ContractProcedureTypes<
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
  TKind extends ProcedureKind,
  TCapability extends ProcedureCapability,
> = ProcedureTypes<TRootContext, TRootContext, TInput, TOutput, TDefinitions, TKind, TCapability>;

export type ExecutableProcedureTypes<
  TRootContext,
  TContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
  TKind extends ProcedureKind,
  TCapability extends ProcedureCapability,
> = ProcedureTypes<TRootContext, TContext, TInput, TOutput, TDefinitions, TKind, TCapability>;

export interface ProcedureManifest<TTypes extends AnyProcedureTypes> {
  readonly kind: TTypes["kind"];
  readonly input: WireCodec<TTypes["input"], WireValue>;
  readonly output: WireCodec<TTypes["output"], WireValue>;
  readonly definitions: TTypes["definitions"];
  readonly capability: TTypes["capability"];
  readonly affects?: readonly AffectsEntry[];
  readonly writes?: readonly WritesEntry[];
  readonly pagination?: PaginationManifest;
  readonly writesHeaders?: true;
  readonly middlewares: readonly RuntimeMiddleware[];
  readonly handler: (
    args: ProcedureHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>,
  ) => MaybePromise<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>;
}

export interface Procedure<TTypes extends AnyProcedureTypes> extends ProcedureTypeCarrier<TTypes> {
  readonly _kind: "procedure";
  readonly _def: ProcedureManifest<TTypes>;
}

/** A query whose manifest proves the correlated list, cursor, and item types. */
export interface SubscriptionProcedureManifest<
  TTypes extends AnyProcedureTypes & { readonly kind: "subscription" },
> extends ProcedureContractManifest<TTypes> {
  readonly middlewares: readonly RuntimeMiddleware[];
  readonly handler: (
    args: SubscriptionHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>,
  ) => MaybePromise<AsyncIterable<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>>;
}

export interface SubscriptionProcedure<
  TTypes extends AnyProcedureTypes & { readonly kind: "subscription" },
> extends ProcedureTypeCarrier<TTypes> {
  readonly _kind: "subscription-procedure";
  readonly _def: SubscriptionProcedureManifest<TTypes>;
}

/** Runtime procedure shape. Handler invocation remains behind the executor proof boundary. */
export interface AnyUnaryProcedure extends ProcedureTypeCarrier<AnyProcedureTypes> {
  readonly _kind: "procedure";
  readonly _def: {
    readonly kind: "query" | "mutation";
    readonly input: import("../wire.js").AnyWireCodec;
    readonly output: import("../wire.js").AnyWireCodec;
    readonly definitions: ErrorDefinitionMap;
    readonly capability: ProcedureCapability;
    readonly middlewares: readonly RuntimeMiddleware[];
    readonly handler: (args: never) => unknown;
    readonly affects?: readonly AffectsEntry[];
    readonly writes?: readonly WritesEntry[];
    readonly pagination?: PaginationManifest;
    readonly writesHeaders?: true;
  };
}
export interface AnySubscriptionProcedure extends ProcedureTypeCarrier<AnyProcedureTypes> {
  readonly _kind: "subscription-procedure";
  readonly _def: {
    readonly kind: "subscription";
    readonly input: import("../wire.js").AnyWireCodec;
    readonly output: import("../wire.js").AnyWireCodec;
    readonly definitions: ErrorDefinitionMap;
    readonly capability: ProcedureCapability;
    readonly pagination?: PaginationManifest;
    readonly writesHeaders?: true;
    readonly resumable?: { readonly eventId: (value: never) => string };
    readonly middlewares: readonly RuntimeMiddleware[];
    readonly handler: (args: never) => unknown;
  };
}
export type AnyProcedure = AnyUnaryProcedure | AnySubscriptionProcedure;

export class ProcedureBuilder<TTypes extends AnyProcedureTypes> {
  constructor(
    private readonly declaration: ProcedureDeclaration<TTypes>,
    private readonly middlewares: readonly RuntimeMiddleware[] = [],
  ) {}

  /**
   * Declares that this procedure writes response headers — the login mutation
   * setting a session cookie is the canonical case. Adds `context.headers`,
   * a `Headers` you `append()` to; several procedures in one batch each get
   * their `set-cookie` through without overwriting one another.
   *
   * The declaration is the point: it is recorded in the contract, so a
   * transport knows before dispatch that this call's response headers cannot
   * be sent early. Undeclared procedures have no `context.headers` at all,
   * which turns "my cookie silently vanished under a streaming transport"
   * into a type error.
   */
  headers(): ProcedureBuilder<WithProcedureHeaders<TTypes>> {
    return new ProcedureBuilder(this.declaration.headers(), this.middlewares);
  }

  /**
   * Declares that this subscription can resume after an interrupted
   * connection. `eventId` derives a resume token from an event's value; the
   * client remembers the last one it decoded and the handler receives it as
   * `lastEventId` on the next connect, so the stream continues instead of
   * replaying from the top.
   *
   * The token is derived on both sides from the same declared function, so no
   * event id travels on the wire and the procedure's input codec — and the
   * contract digest's view of it — is unchanged.
   */
  resumable(options: {
    readonly eventId: (value: TTypes["output"]) => string;
  }): ProcedureBuilder<WithProcedureResumable<TTypes>> {
    return new ProcedureBuilder(this.declaration.resumable(options), this.middlewares);
  }

  /**
   * Declares the entity this mutation writes when the output doesn't carry
   * it. Invalidation-only: returning the entity instead earns in-place
   * patches everywhere it appears.
   */
  writes<TModel extends AnyModel>(
    model: TModel,
    map: (input: TTypes["input"]) => ModelKeyInput<TModel>,
  ): ProcedureBuilder<
    WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>
  > {
    return new ProcedureBuilder(this.declaration.writes(model, map), this.middlewares);
  }

  /**
   * Declares that this mutation invalidates a query on success. `map` turns
   * the mutation's input into the target query's input; omit it to invalidate
   * every cached input of that query. Executed automatically by the client
   * cache — call sites need no `onSettled`.
   */
  affects<const TTarget extends QueryAffectsTarget>(
    target: TTarget,
    map?: (input: TTypes["input"]) => ProcedureAffectsInput<TTarget>,
  ): ProcedureBuilder<
    WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>
  > {
    return new ProcedureBuilder(this.declaration.affects(target, map), this.middlewares);
  }

  input<TNewInput, TEncoded extends WireValue>(
    this: ProcedureBuilder<TTypes> & ProcedureInputConstraint<TTypes>,
    codec: WireCodec<TNewInput, TEncoded>,
  ): ProcedureBuilder<WithProcedureInput<TTypes, TNewInput>> {
    return new ProcedureBuilder(this.declaration.input(codec), this.middlewares);
  }

  output<TNewOutput, TEncoded extends WireValue>(
    codec: WireCodec<TNewOutput, TEncoded>,
  ): ProcedureBuilder<WithProcedureOutput<TTypes, TNewOutput>> {
    return new ProcedureBuilder(this.declaration.output(codec), this.middlewares);
  }

  errors<const TNewDefinitions extends ErrorDefinitionMap>(
    definitions: TNewDefinitions &
      DefinitionMapCompatibility<TTypes["definitions"], NoInfer<TNewDefinitions>>,
  ): ProcedureBuilder<
    WithProcedureDefinitions<TTypes, MergeDefinitionMaps<TTypes["definitions"], TNewDefinitions>>
  > {
    return new ProcedureBuilder(
      this.declaration.errors<TNewDefinitions>(definitions),
      this.middlewares,
    );
  }

  use<TMiddlewareTypes extends AnyMiddlewareTypes>(
    middleware: Middleware<TMiddlewareTypes> &
      MiddlewareContextCompatibility<TTypes["context"], TMiddlewareTypes["inputContext"]> &
      DefinitionSourcesCompatibility<
        TTypes["definitions"],
        NoInfer<TMiddlewareTypes["definitionSources"]>
      >,
  ): ProcedureBuilder<
    WithProcedureMiddleware<
      TTypes,
      TMiddlewareTypes["outputContext"],
      MergeDefinitionMaps<
        TTypes["definitions"],
        MaterializeDefinitionSources<TMiddlewareTypes["definitionSources"]>
      >,
      BooleanOr<TTypes["writesHeaders"], TMiddlewareTypes["writesHeaders"]>
    >
  > {
    const definitions = mergeDefinitionMaps(this.declaration.definitions, middleware.definitions);
    const writesHeaders = booleanOr(this.declaration.writesHeaders, middleware.writesHeaders);
    return new ProcedureBuilder<
      WithProcedureMiddleware<
        TTypes,
        TMiddlewareTypes["outputContext"],
        MergeDefinitionMaps<
          TTypes["definitions"],
          MaterializeDefinitionSources<TMiddlewareTypes["definitionSources"]>
        >,
        BooleanOr<TTypes["writesHeaders"], TMiddlewareTypes["writesHeaders"]>
      >
    >(
      this.declaration.rebind<
        TMiddlewareTypes["outputContext"],
        MergeDefinitionMaps<
          TTypes["definitions"],
          MaterializeDefinitionSources<TMiddlewareTypes["definitionSources"]>
        >,
        UnaryProcedureCapability<
          BooleanOr<TTypes["writesHeaders"], TMiddlewareTypes["writesHeaders"]>
        >
      >(definitions, writesHeaders),
      appendMiddleware(this.middlewares, middleware),
    );
  }

  query(
    this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">,
  ): ProcedureContract<
    ContractProcedureTypes<
      TTypes["rootContext"],
      TTypes["input"],
      TTypes["output"],
      TTypes["definitions"],
      "query",
      UnaryProcedureCapability<TTypes["writesHeaders"]>
    >
  >;
  query(
    this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">,
    handler: (
      args: ProcedureHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>,
    ) => MaybePromise<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>,
  ): Procedure<
    CompleteProcedureTypes<TTypes, "query", UnaryProcedureCapability<TTypes["writesHeaders"]>>
  >;
  query(
    this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">,
    handler?: (
      args: ProcedureHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>,
    ) => MaybePromise<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>,
  ):
    | ProcedureContract<
        ContractProcedureTypes<
          TTypes["rootContext"],
          TTypes["input"],
          TTypes["output"],
          TTypes["definitions"],
          "query",
          UnaryProcedureCapability<TTypes["writesHeaders"]>
        >
      >
    | Procedure<
        CompleteProcedureTypes<TTypes, "query", UnaryProcedureCapability<TTypes["writesHeaders"]>>
      > {
    return handler === undefined ? this.finishContract("query") : this.finish("query", handler);
  }

  mutation(
    this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "mutation">,
  ): ProcedureContract<
    ContractProcedureTypes<
      TTypes["rootContext"],
      TTypes["input"],
      TTypes["output"],
      TTypes["definitions"],
      "mutation",
      UnaryProcedureCapability<TTypes["writesHeaders"]>
    >
  >;
  mutation(
    this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "mutation">,
    handler: (
      args: ProcedureHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>,
    ) => MaybePromise<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>,
  ): Procedure<
    CompleteProcedureTypes<TTypes, "mutation", UnaryProcedureCapability<TTypes["writesHeaders"]>>
  >;
  mutation(
    this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "mutation">,
    handler?: (
      args: ProcedureHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>,
    ) => MaybePromise<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>,
  ):
    | ProcedureContract<
        ContractProcedureTypes<
          TTypes["rootContext"],
          TTypes["input"],
          TTypes["output"],
          TTypes["definitions"],
          "mutation",
          UnaryProcedureCapability<TTypes["writesHeaders"]>
        >
      >
    | Procedure<
        CompleteProcedureTypes<
          TTypes,
          "mutation",
          UnaryProcedureCapability<TTypes["writesHeaders"]>
        >
      > {
    return handler === undefined
      ? this.finishContract("mutation")
      : this.finish("mutation", handler);
  }

  subscription(
    this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "subscription">,
  ): ProcedureContract<
    ContractProcedureTypes<
      TTypes["rootContext"],
      TTypes["input"],
      TTypes["output"],
      TTypes["definitions"],
      "subscription",
      UnaryProcedureCapability<TTypes["writesHeaders"]>
    >
  > {
    return this.finishContract("subscription");
  }

  /**
   * Finishes a paginated query. `.output()` declares the ROW codec; this
   * builds the page envelope (`{ items, nextCursor }`) and splits the wire
   * input into `{ list, cursor }` — list identity vs position — so the
   * client engine keys ONE cache entry per list and threads cursors itself.
   * Still a query on the wire: batching, digests, `.affects()` targeting,
   * and entity patches all apply unchanged.
   */
  paginate<TCursor>(
    this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">,
    options: {
      readonly cursor: WireCodec<TCursor, WireValue>;
    },
  ): ProcedureContract<
    ContractProcedureTypes<
      TTypes["rootContext"],
      PageRequest<TTypes["input"], TCursor>,
      Page<TTypes["output"], TCursor>,
      TTypes["definitions"],
      "query",
      PaginatedProcedureCapability<
        TTypes["input"],
        TCursor,
        TTypes["output"],
        TTypes["writesHeaders"]
      >
    >
  >;
  paginate<TCursor>(
    this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">,
    options: { readonly cursor: WireCodec<TCursor, WireValue> },
    handler: (
      args: ProcedureHandlerArgs<
        TTypes["context"],
        PageRequest<TTypes["input"], TCursor>,
        TTypes["definitions"]
      >,
    ) => MaybePromise<Result<Page<TTypes["output"], TCursor>, ErrorUnion<TTypes["definitions"]>>>,
  ): Procedure<
    CompleteProcedureTypes<
      TTypes,
      "query",
      PaginatedProcedureCapability<
        TTypes["input"],
        TCursor,
        TTypes["output"],
        TTypes["writesHeaders"]
      >,
      PageRequest<TTypes["input"], TCursor>,
      Page<TTypes["output"], TCursor>
    >
  >;
  paginate<TCursor>(
    this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">,
    options: { readonly cursor: WireCodec<TCursor, WireValue> },
    handler?: (
      args: ProcedureHandlerArgs<
        TTypes["context"],
        PageRequest<TTypes["input"], TCursor>,
        TTypes["definitions"]
      >,
    ) => MaybePromise<Result<Page<TTypes["output"], TCursor>, ErrorUnion<TTypes["definitions"]>>>,
  ):
    | ProcedureContract<
        ContractProcedureTypes<
          TTypes["rootContext"],
          PageRequest<TTypes["input"], TCursor>,
          Page<TTypes["output"], TCursor>,
          TTypes["definitions"],
          "query",
          PaginatedProcedureCapability<
            TTypes["input"],
            TCursor,
            TTypes["output"],
            TTypes["writesHeaders"]
          >
        >
      >
    | Procedure<
        CompleteProcedureTypes<
          TTypes,
          "query",
          PaginatedProcedureCapability<
            TTypes["input"],
            TCursor,
            TTypes["output"],
            TTypes["writesHeaders"]
          >,
          PageRequest<TTypes["input"], TCursor>,
          Page<TTypes["output"], TCursor>
        >
      > {
    const definition = this.declaration.paginated(options.cursor);
    if (handler === undefined) {
      return Object.freeze({
        _kind: "procedure-contract" as const,
        _def: definition,
      });
    }
    return Object.freeze({
      _kind: "procedure" as const,
      _def: Object.freeze({
        ...definition,
        middlewares: this.middlewares,
        handler,
      }),
    });
  }

  private finishContract<TKind extends "query" | "mutation" | "subscription">(
    kind: TKind,
  ): ProcedureContract<
    ContractProcedureTypes<
      TTypes["rootContext"],
      TTypes["input"],
      TTypes["output"],
      TTypes["definitions"],
      TKind,
      UnaryProcedureCapability<TTypes["writesHeaders"]>
    >
  > {
    return Object.freeze({
      _kind: "procedure-contract" as const,
      _def: this.declaration.unary(kind),
    });
  }

  private finish<TKind extends "query" | "mutation">(
    kind: TKind,
    handler: (
      args: ProcedureHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>,
    ) => MaybePromise<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>,
  ): Procedure<
    CompleteProcedureTypes<TTypes, TKind, UnaryProcedureCapability<TTypes["writesHeaders"]>>
  > {
    const definition = this.declaration.unary(kind);
    return Object.freeze({
      _kind: "procedure" as const,
      _def: Object.freeze({
        ...definition,
        middlewares: this.middlewares,
        handler,
      }),
    });
  }
}

export type UndeclaredMiddlewareErrors<
  TDeclared extends ErrorDefinitionMap,
  TContributed extends ErrorDefinitionMap,
> = Exclude<ErrorUnion<TContributed>, ErrorUnion<TDeclared>>;

export type MiddlewareContractCompatibility<
  TDeclared extends ErrorDefinitionMap,
  TCapability extends ProcedureCapability,
  TContributed extends ErrorDefinitionMap,
  TWritesHeaders extends boolean,
> = [UndeclaredMiddlewareErrors<TDeclared, TContributed>] extends [never]
  ? TWritesHeaders extends true
    ? TCapability["writesHeaders"] extends true
      ? unknown
      : RpcConstraintError<"middleware-writes-headers-but-contract-does-not", true>
    : unknown
  : RpcConstraintError<
      "middleware-errors-missing-from-contract",
      UndeclaredMiddlewareErrors<TDeclared, TContributed>["_tag"]
    >;

export type ProcedureImplementationMiddlewareConstraint<
  TContractTypes extends AnyProcedureTypes,
  TContext,
  TMiddlewareTypes extends AnyMiddlewareTypes,
> = MiddlewareContextCompatibility<TContext, TMiddlewareTypes["inputContext"]> &
  MiddlewareContractCompatibility<
    TContractTypes["definitions"],
    TContractTypes["capability"],
    TMiddlewareTypes["definitionSources"],
    TMiddlewareTypes["writesHeaders"]
  >;

export type ImplementedProcedureTypes<
  TContractTypes extends AnyProcedureTypes,
  TContext,
  TKind extends ProcedureKind = TContractTypes["kind"],
> = ProcedureTypes<
  TContractTypes["rootContext"],
  TContext,
  TContractTypes["input"],
  TContractTypes["output"],
  TContractTypes["definitions"],
  TKind,
  TContractTypes["capability"]
>;

export type ImplementationContext<
  TRootContext,
  TContractTypes extends AnyProcedureTypes,
> = TContractTypes["writesHeaders"] extends true
  ? TRootContext & { readonly headers: Headers }
  : TRootContext;

export type ProcedureImplementationContextConstraint<
  TRootContext,
  TContractTypes extends AnyProcedureTypes,
> = [Exclude<TRootContext, TContractTypes["rootContext"]>] extends [never]
  ? unknown
  : RpcConstraintError<
      "procedure-contract-requires-incompatible-context",
      {
        readonly available: TRootContext;
        readonly required: TContractTypes["rootContext"];
      }
    >;

export class ProcedureImplementer<TContractTypes extends AnyProcedureTypes, TContext> {
  constructor(
    private readonly contract: ProcedureContract<TContractTypes>,
    private readonly middlewares: readonly RuntimeMiddleware[] = [],
  ) {}

  use<TMiddlewareTypes extends AnyMiddlewareTypes>(
    middleware: Middleware<TMiddlewareTypes> &
      ProcedureImplementationMiddlewareConstraint<
        TContractTypes,
        TContext,
        NoInfer<TMiddlewareTypes>
      >,
    // A middleware replaces the context, which would drop the `headers` the
    // contract's `.headers()` contributed. The contract is the authority on
    // whether this procedure writes them, so re-apply the same rule `implement`
    // used rather than trusting whatever the middleware happened to pass on.
  ): ProcedureImplementer<
    TContractTypes,
    ImplementationContext<TMiddlewareTypes["outputContext"], TContractTypes>
  > {
    assertDefinitionsAreDeclared(this.contract._def.definitions, middleware.definitions);
    if (middleware.writesHeaders === true && this.contract._def.writesHeaders !== true) {
      throw new TypeError(
        "This middleware writes response headers, so the contract must declare .headers(). " +
          "The declaration lives on the contract because transports read it before dispatch.",
      );
    }
    return new ProcedureImplementer(this.contract, appendMiddleware(this.middlewares, middleware));
  }

  handler(
    this: TContractTypes["kind"] extends "subscription"
      ? never
      : ProcedureImplementer<TContractTypes, TContext>,
    handler: (
      args: ProcedureHandlerArgs<TContext, TContractTypes["input"], TContractTypes["definitions"]>,
    ) => MaybePromise<Result<TContractTypes["output"], ErrorUnion<TContractTypes["definitions"]>>>,
  ): Procedure<
    ImplementedProcedureTypes<
      TContractTypes,
      TContext,
      Extract<TContractTypes["kind"], "query" | "mutation">
    >
  > {
    const definition = this.contract._def;
    assertUnaryProcedureKind(definition.kind);
    const kind = definition.kind;
    return Object.freeze({
      _kind: "procedure" as const,
      _def: Object.freeze({
        ...definition,
        kind,
        middlewares: this.middlewares,
        handler,
      }),
    });
  }

  stream(
    this: TContractTypes["kind"] extends "subscription"
      ? ProcedureImplementer<TContractTypes, TContext>
      : never,
    handler: (
      args: SubscriptionHandlerArgs<
        TContext,
        TContractTypes["input"],
        TContractTypes["definitions"]
      >,
    ) => MaybePromise<
      AsyncIterable<Result<TContractTypes["output"], ErrorUnion<TContractTypes["definitions"]>>>
    >,
  ): SubscriptionProcedure<ImplementedProcedureTypes<TContractTypes, TContext, "subscription">> {
    if (this.contract._def.kind !== "subscription") {
      throw new TypeError("Only a subscription contract can be implemented with stream()");
    }
    return Object.freeze({
      _kind: "subscription-procedure" as const,
      _def: Object.freeze({
        ...this.contract._def,
        kind: "subscription" as const,
        middlewares: this.middlewares,
        handler,
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

export type ProcedureRootContext<TProcedure> = ProcedureTypesOf<TProcedure>["rootContext"];

/** Recursively proves that a router's supplied context satisfies every procedure. */
export type ContextCompatibleRouterRecord<TRootContext, TRecord extends RouterRecord> = {
  readonly [TKey in keyof TRecord]: TRecord[TKey] extends AnyProcedure
    ? TRootContext extends ProcedureRootContext<TRecord[TKey]>
      ? TRecord[TKey]
      : RpcConstraintError<
          "router-procedure-requires-incompatible-context",
          {
            readonly available: TRootContext;
            readonly required: ProcedureRootContext<TRecord[TKey]>;
          }
        >
    : TRecord[TKey] extends RouterRecord
      ? ContextCompatibleRouterRecord<TRootContext, TRecord[TKey]>
      : never;
};

export type ContextCompatibleContractRecord<TRootContext, TRecord extends ContractRouterRecord> = {
  readonly [TKey in keyof TRecord]: TRecord[TKey] extends AnyProcedureContract
    ? TRootContext extends ProcedureRootContext<TRecord[TKey]>
      ? TRecord[TKey]
      : RpcConstraintError<
          "router-procedure-requires-incompatible-context",
          {
            readonly available: TRootContext;
            readonly required: ProcedureRootContext<TRecord[TKey]>;
          }
        >
    : TRecord[TKey] extends ContractRouterRecord
      ? ContextCompatibleContractRecord<TRootContext, TRecord[TKey]>
      : never;
};

/** Every compile-time fact carried by an executable router or shared contract. */
export interface RouterTypes<TRootContext, TRecord extends RouterRecord | ContractRouterRecord> {
  readonly rootContext: TRootContext;
  readonly record: TRecord;
}

/** Runtime-erased router facts. */
export interface AnyRouterTypes {
  readonly rootContext: unknown;
  readonly record: RouterRecord | ContractRouterRecord;
}

declare const routerTypes: unique symbol;

export interface RouterContract<TTypes extends RouterTypes<unknown, ContractRouterRecord>> {
  readonly _kind: "router-contract";
  readonly record: TTypes["record"];
  readonly procedures: ReadonlyMap<string, AnyProcedureContract>;
  /** The application error registry: every declared tag, exactly one definition each. */
  readonly errors: ReadonlyMap<string, AnyPublicErrorDefinition>;
  readonly [routerTypes]?: TTypes;
}

export interface Router<TTypes extends RouterTypes<unknown, RouterRecord>> {
  readonly _kind: "router";
  readonly record: TTypes["record"];
  readonly procedures: ReadonlyMap<string, AnyProcedure>;
  /** The application error registry: every declared tag, exactly one definition each. */
  readonly errors: ReadonlyMap<string, AnyPublicErrorDefinition>;
  readonly [routerTypes]?: TTypes;
}

export type AnyRouterContract = RouterContract<RouterTypes<unknown, ContractRouterRecord>>;
export type AnyRouter = Router<RouterTypes<unknown, RouterRecord>>;

/**
 * The router is the error registry: one tag maps to exactly one definition
 * across the whole application. This is what makes tags safe as global
 * identities — shells claim ambiently by tag alone, so two procedures reusing
 * a tag must share the definition (same reference), never redeclare it.
 */
const collectErrorRegistry = (
  procedures: ReadonlyMap<string, { readonly _def: { readonly definitions: ErrorDefinitionMap } }>,
): ReadonlyMap<string, AnyPublicErrorDefinition> => {
  const byTag = new Map<string, AnyPublicErrorDefinition>();
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

const RESERVED_ROUTER_KEYS = new Set([
  "_kind",
  "record",
  "procedures",
  "errors",
  "$errors",
  "_rootContext",
]);

const createRouter = <TRootContext, const TRecord extends RouterRecord>(
  record: TRecord,
): Router<RouterTypes<TRootContext, TRecord>> => {
  const procedures = new Map<string, AnyProcedure>();
  const isProcedure = (value: AnyProcedure | RouterRecord): value is AnyProcedure =>
    "_kind" in value && (value._kind === "procedure" || value._kind === "subscription-procedure");
  const visit = (node: RouterRecord, prefix: readonly string[]) => {
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key];
      if (isProcedure(value)) procedures.set(path.join("."), value);
      else visit(value, path);
    }
  };
  visit(record, []);
  for (const key of Object.keys(record)) {
    if (RESERVED_ROUTER_KEYS.has(key)) {
      throw new TypeError(`Router key ${key} collides with a reserved property`);
    }
  }
  const errors = collectErrorRegistry(procedures);
  return Object.freeze({ _kind: "router" as const, record, procedures, errors });
};

const createRouterContract = <TRootContext, const TRecord extends ContractRouterRecord>(
  record: TRecord,
): RouterContract<RouterTypes<TRootContext, TRecord>> & TRecord => {
  const procedures = new Map<string, AnyProcedureContract>();
  const isProcedureContract = (
    value: AnyProcedureContract | ContractRouterRecord,
  ): value is AnyProcedureContract => "_kind" in value && value._kind === "procedure-contract";
  const visit = (node: ContractRouterRecord, prefix: readonly string[]) => {
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key];
      if (isProcedureContract(value)) procedures.set(path.join("."), value);
      else visit(value, path);
    }
  };
  visit(record, []);
  for (const key of Object.keys(record)) {
    if (RESERVED_ROUTER_KEYS.has(key)) {
      throw new TypeError(`Contract key ${key} collides with a reserved property`);
    }
  }
  const errors = collectErrorRegistry(procedures);
  // Entries are spread onto the contract so call sites read
  // `server.implement(contract.list)` rather than `contract.record.list`.
  // Traversal above validated every leaf/reserved key; dynamic spread erases
  // only the exact TRecord intersection restored here.
  return Object.freeze({
    ...record,
    _kind: "router-contract" as const,
    record,
    procedures,
    errors,
  }) as RouterContract<RouterTypes<TRootContext, TRecord>> & TRecord;
};

export interface RpcFactory<TRootContext> extends RpcFactoryTypeCarrier<
  RpcFactoryTypes<TRootContext>
> {
  procedure(): ProcedureBuilder<
    ProcedureTypes<
      TRootContext,
      TRootContext,
      EmptyObject,
      never,
      {},
      ProcedureKind,
      UnaryProcedureCapability
    >
  >;
  middleware<TAddedContext = {}>(): MiddlewareBuilder<
    MiddlewareBuilderTypes<TRootContext, TRootContext, TAddedContext, never>
  >;
  router<const TRecord extends RouterRecord>(
    record: TRecord & ContextCompatibleRouterRecord<TRootContext, TRecord>,
  ): Router<RouterTypes<TRootContext, TRecord>>;
  contract<const TRecord extends ContractRouterRecord>(
    record: TRecord & ContextCompatibleContractRecord<TRootContext, TRecord>,
  ): RouterContract<RouterTypes<TRootContext, TRecord>> & TRecord;
  implement<TContractTypes extends AnyProcedureTypes>(
    contract: ProcedureContract<TContractTypes> &
      ProcedureImplementationContextConstraint<TRootContext, TContractTypes>,
  ): ProcedureImplementer<TContractTypes, ImplementationContext<TRootContext, TContractTypes>>;
}

const factory = <TRootContext>(): RpcFactory<TRootContext> => ({
  procedure: () =>
    new ProcedureBuilder<
      ProcedureTypes<
        TRootContext,
        TRootContext,
        EmptyObject,
        never,
        {},
        ProcedureKind,
        UnaryProcedureCapability
      >
    >(procedureDeclaration(wire.object({}), {}, false)),
  middleware: <TAddedContext = {}>() =>
    new MiddlewareBuilder<
      MiddlewareBuilderTypes<TRootContext, TRootContext, TAddedContext, never>
    >(),
  router: (record) => createRouter<TRootContext, typeof record>(record),
  contract: (record) => createRouterContract<TRootContext, typeof record>(record),
  implement: (contract) => new ProcedureImplementer(contract),
});

export const rpc = Object.assign(factory<unknown>(), {
  context: <TRootContext>() => factory<TRootContext>(),
});

export { assertDefinitionsCanMerge } from "../error-map.js";

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
const badInputFailure = (cause: unknown): Result<never, ReturnType<typeof ServerBadRequest>> =>
  err(badRequestFromIssues(cause));

const internalFailure = (
  phase: InternalErrorEvent["phase"],
  cause: unknown,
  options: ExecutionOptions<unknown>,
): Result<never, ReturnType<typeof ServerInternal>> => {
  // The caller leaving is control flow, not a handler defect. Re-throw the
  // original cancellation so the transport boundary can stop without
  // manufacturing an incident or a server/internal value for nobody to read.
  if (options.signal?.aborted) throw cause;
  const id = incidentId();
  options.onInternalError?.({
    incidentId: id,
    phase,
    cause,
    ...(options.procedurePath === undefined ? {} : { procedurePath: options.procedurePath }),
  });
  return err(ServerInternal({ incidentId: id }));
};

/**
 * Reifies an erased middleware/handler return before another middleware can
 * observe it. Malformed shapes and untagged error channels become defects at
 * the exact boundary that produced them.
 */
const normalizeRuntimeResult = (
  candidate: unknown,
  phase: "middleware" | "handler",
  options: ExecutionOptions<unknown>,
): Result<unknown, AnyTaggedError> => {
  if (candidate !== null && typeof candidate === "object" && "ok" in candidate) {
    if (candidate.ok === true && "value" in candidate) return ok(candidate.value);
    if (candidate.ok === false && "error" in candidate && isTaggedError(candidate.error)) {
      return err(candidate.error);
    }
  }
  return internalFailure(phase, candidate, options);
};

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  value !== null &&
  typeof value === "object" &&
  Symbol.asyncIterator in value &&
  typeof value[Symbol.asyncIterator] === "function";

function assertUnaryProcedureKind<TKind extends ProcedureKind>(
  kind: TKind,
): asserts kind is Extract<TKind, "query" | "mutation"> {
  if (kind === "subscription") {
    throw new TypeError("A subscription contract must be implemented with stream()");
  }
}

export function executeProcedure<
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
  TKind extends "query" | "mutation",
>(
  procedure: Procedure<
    ExecutableProcedureTypes<
      TRootContext,
      unknown,
      TInput,
      TOutput,
      TDefinitions,
      TKind,
      ProcedureCapability
    >
  >,
  input: TInput,
  options: ExecutionOptions<TRootContext>,
): Promise<
  Result<
    TOutput,
    | ErrorUnion<TDefinitions>
    | ReturnType<typeof ServerInternal>
    | ReturnType<typeof ServerBadRequest>
  >
>;
export function executeProcedure(
  procedure: AnyUnaryProcedure,
  input: unknown,
  options: ExecutionOptions<unknown>,
): Promise<
  Result<
    unknown,
    AnyTaggedError | ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest>
  >
>;
export async function executeProcedure(
  procedure: AnyUnaryProcedure,
  input: unknown,
  options: ExecutionOptions<unknown>,
): Promise<Result<unknown, AnyTaggedError>> {
  let decodedInput: ReturnType<typeof procedure._def.input.decode>;
  try {
    const encodedInput = encodeProcedureInput(procedure._def.input, input);
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
        return normalizeRuntimeResult(
          await middleware.handler({
            context,
            errors: middleware.ownDefinitions,
            next: ({ context: contribution }) =>
              dispatch(index + 1, mergeMiddlewareContext(context, contribution)),
          }),
          "middleware",
          options,
        );
      } catch (cause) {
        return internalFailure("middleware", cause, options);
      }
    }
    try {
      // Audited executor boundary: input and context were validated/prepared
      // before the runtime-erased handler is invoked.
      const handlerArgs: ProcedureHandlerArgs<unknown, unknown, ErrorDefinitionMap> = {
        context,
        input: decodedInput.value,
        errors: procedure._def.definitions,
        touch: <TModel extends AnyModel>(model: TModel, id: ModelKeyInput<TModel>) =>
          options.onTouch?.(touchedEntityKey(model, id)),
        signal: options.signal ?? neverAborted(),
      };
      return normalizeRuntimeResult(
        await procedure._def.handler(handlerArgs as never),
        "handler",
        options,
      );
    } catch (cause) {
      return internalFailure("handler", cause, options);
    }
  };

  const result = await dispatch(0, contextWithHeaders(options.context, procedure, options));
  if (options.signal?.aborted) throw options.signal.reason;
  if (result.ok) {
    try {
      const encoded = encodeUnknownWireValue(procedure._def.output, result.value);
      if (!encoded.ok) return internalFailure("output", encoded.issues, options);
      const decoded = procedure._def.output.decode(encoded.value);
      if (!decoded.ok) return internalFailure("output", decoded.issues, options);
      return ok(decoded.value);
    } catch (cause) {
      return internalFailure("output", cause, options);
    }
  }

  if (ServerInternal.is(result.error)) {
    return err(result.error);
  }
  let normalizedError: AnyTaggedError;
  try {
    const definition = Object.values(procedure._def.definitions).find(
      (candidate) => candidate.tag === result.error._tag,
    );
    if (!definition || definition.policy.visibility !== "public" || !definition.is(result.error)) {
      return internalFailure("error", result.error, options);
    }
    normalizedError = result.error;
  } catch (cause) {
    return internalFailure("error", cause, options);
  }
  return err(normalizedError);
}

export function executeSubscription<
  TRootContext,
  TInput,
  TOutput,
  TDefinitions extends ErrorDefinitionMap,
>(
  procedure: SubscriptionProcedure<
    ExecutableProcedureTypes<
      TRootContext,
      unknown,
      TInput,
      TOutput,
      TDefinitions,
      "subscription",
      UnaryProcedureCapability
    >
  >,
  input: TInput,
  options: ExecutionOptions<TRootContext>,
): AsyncGenerator<
  Result<
    TOutput,
    | ErrorUnion<TDefinitions>
    | ReturnType<typeof ServerInternal>
    | ReturnType<typeof ServerBadRequest>
  >
>;
export function executeSubscription(
  procedure: AnySubscriptionProcedure,
  input: unknown,
  options: ExecutionOptions<unknown>,
): AsyncGenerator<Result<unknown, AnyTaggedError>>;
export async function* executeSubscription(
  procedure: AnySubscriptionProcedure,
  input: unknown,
  options: ExecutionOptions<unknown>,
): AsyncGenerator<Result<unknown, AnyTaggedError>> {
  let decodedInput: ReturnType<typeof procedure._def.input.decode>;
  try {
    const encodedInput = encodeProcedureInput(procedure._def.input, input);
    if (!encodedInput.ok) {
      yield badInputFailure(encodedInput.issues);
      return;
    }
    decodedInput = procedure._def.input.decode(encodedInput.value);
    if (!decodedInput.ok) {
      yield badInputFailure(decodedInput.issues);
      return;
    }
  } catch (cause) {
    yield internalFailure("input", cause, options);
    return;
  }

  const prepareContext = async (
    index: number,
    context: unknown,
  ): Promise<Result<unknown, AnyTaggedError>> => {
    const middleware = procedure._def.middlewares[index];
    if (!middleware) return ok(context);
    try {
      return normalizeRuntimeResult(
        await middleware.handler({
          context,
          errors: middleware.ownDefinitions,
          next: ({ context: contribution }) =>
            prepareContext(index + 1, mergeMiddlewareContext(context, contribution)),
        }),
        "middleware",
        options,
      );
    } catch (cause) {
      return internalFailure("middleware", cause, options);
    }
  };

  const prepared = await prepareContext(0, contextWithHeaders(options.context, procedure, options));
  if (!prepared.ok) {
    if (ServerInternal.is(prepared.error)) {
      yield err(prepared.error);
    } else {
      const definition = Object.values(procedure._def.definitions).find(
        (candidate) => candidate.tag === prepared.error._tag,
      );
      yield definition?.policy.visibility === "public" && definition.is(prepared.error)
        ? err(prepared.error)
        : internalFailure("error", prepared.error, options);
    }
    return;
  }

  let iterable: AsyncIterable<unknown>;
  try {
    const handlerArgs: SubscriptionHandlerArgs<unknown, unknown, ErrorDefinitionMap> = {
      context: prepared.value,
      input: decodedInput.value,
      errors: procedure._def.definitions,
      // Undefined unless this subscription declared `.resumable()` — the HTTP
      // layer refuses to forward a resume point to one that did not.
      lastEventId: options.lastEventId,
      touch: <TModel extends AnyModel>(model: TModel, id: ModelKeyInput<TModel>) =>
        options.onTouch?.(touchedEntityKey(model, id)),
      signal: options.signal ?? neverAborted(),
    };
    const candidate = await procedure._def.handler(handlerArgs as never);
    if (!isAsyncIterable(candidate)) {
      yield internalFailure("handler", candidate, options);
      return;
    }
    iterable = candidate;
  } catch (cause) {
    yield internalFailure("handler", cause, options);
    return;
  }

  // Drive the producer with an explicit iterator so the caller-lifetime
  // signal can close it DIRECTLY. When the consumer walks away while the
  // producer is parked at a yield with no next() outstanding, nothing else
  // would ever resume it — this listener is what runs its `finally`.
  let inner: AsyncIterator<unknown>;
  try {
    inner = iterable[Symbol.asyncIterator]();
  } catch (cause) {
    yield internalFailure("handler", cause, options);
    return;
  }
  const closeInner = () => {
    void closeIterator(inner).catch(() => undefined);
  };
  if (options.signal) {
    if (options.signal.aborted) closeInner();
    else options.signal.addEventListener("abort", closeInner, { once: true });
  }
  try {
    while (true) {
      const step = await inner.next();
      if (options.signal?.aborted) return;
      if (step.done) return;
      const result = normalizeRuntimeResult(step.value, "handler", options);
      if (result.ok) {
        const encoded = encodeUnknownWireValue(procedure._def.output, result.value);
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
      if (ServerInternal.is(result.error)) {
        yield err(result.error);
        return;
      }
      const definition = Object.values(procedure._def.definitions).find(
        (candidate) => candidate.tag === result.error._tag,
      );
      if (definition?.policy.visibility !== "public" || !definition.is(result.error)) {
        yield internalFailure("error", result.error, options);
      } else {
        yield err(result.error);
      }
      return;
    }
  } catch (cause) {
    yield internalFailure("handler", cause, options);
  } finally {
    options.signal?.removeEventListener("abort", closeInner);
    closeInner();
  }
}

export type RouterTypesOf<TRouter> =
  TRouter extends Router<infer TTypes>
    ? TTypes
    : TRouter extends RouterContract<infer TTypes>
      ? TTypes
      : never;

export type RouterContext<TRouter> = RouterTypesOf<TRouter>["rootContext"];
export type RouterRecordOf<TRouter> = RouterTypesOf<TRouter>["record"];

export type HasDef = AnyProcedure | AnyProcedureContract;

export type MapRecord<TRecord, TProject> = {
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

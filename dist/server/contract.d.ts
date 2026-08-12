import { type AnyPublicErrorDefinition, type AnyTaggedError } from "../error.js";
import type { RpcFactoryTypeCarrier, RpcFactoryTypes } from "../factory-types.js";
import { type DefinitionMapCompatibility, type DefinitionSourcesCompatibility, type ErrorDefinitionMap, type ErrorUnion, type MaterializeDefinitionSources, type MergeDefinitionMaps, type MergeDefinitionSources } from "../error-map.js";
import { ServerBadRequest, ServerInternal } from "../framework-errors.js";
import { type AnyModel, type ModelKeyInput } from "../model.js";
import { PaginatedProcedureCapability, type ProcedureCapability, type UnaryProcedureCapability } from "../procedure-capability.js";
import { type ProcedureDeclaration } from "../procedure-declaration.js";
import type { AffectsEntry, AnyProcedureContract, AnyProcedureTypes, CompleteProcedureTypes, Page, PageRequest, PaginationManifest, ProcedureAffectsInput, ProcedureContract, ProcedureContractManifest, ProcedureError, ProcedureInput, ProcedureInputConstraint, ProcedureKind, ProcedureOutput, ProcedureTypeCarrier, ProcedureTerminalConstraint, ProcedureTypes, ProcedureTypesOf, QueryAffectsTarget, WithProcedureDefinitions, WithProcedureHeaders, WithProcedureResumable, WithProcedureInput, WithProcedureKinds, WithProcedureMappedInput, WithProcedureMiddleware, WithProcedureOutput, WritesEntry } from "../procedure-types.js";
import { type Result } from "../result.js";
import type { RpcConstraintError } from "../type-diagnostics.js";
import type { EmptyObject, WireCodec, WireValue } from "../wire.js";
export type { ErrorDefinitionMap, ErrorUnion, MergeDefinitionMaps } from "../error-map.js";
export { PaginatedProcedureCapability, type ProcedureCapability, type UnaryProcedureCapability, } from "../procedure-capability.js";
export type { AffectsEntry, AnyProcedureContract, AnyProcedureTypes, CompleteProcedureTypes, Page, PageRequest, PaginationManifest, ProcedureAffectsInput, ProcedureContract, ProcedureContractManifest, ProcedureInputConstraint, ProcedureInput, ProcedureKind, ProcedureOutput, ProcedureError, ProcedureTypeCarrier, ProcedureTerminalConstraint, ProcedureTypes, ProcedureTypesOf, QueryAffectsTarget, WithProcedureContext, WithProcedureDefinitions, WithProcedureHeaders, WithProcedureInput, WithProcedureKinds, WithProcedureMappedInput, WithProcedureMiddleware, WithProcedureOutput, WithProcedureResumable, WritesEntry, } from "../procedure-types.js";
import type { MaybePromise } from "../types.js";
export type BooleanOr<TLeft extends boolean, TRight extends boolean> = TLeft extends true ? true : TRight extends true ? true : false;
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
declare const middlewareNextResult: unique symbol;
export type MiddlewareNextResult = Result<unknown, AnyTaggedError> & {
    readonly [middlewareNextResult]: true;
};
export interface MiddlewareNext<TContribution> {
    (options: {
        readonly context: TContribution;
    }): Promise<MiddlewareNextResult>;
}
export interface MiddlewareHandlerArgs<TInputContext, TContribution, TDefinitionSources extends ErrorDefinitionMap> {
    readonly context: TInputContext;
    readonly errors: MaterializeDefinitionSources<TDefinitionSources>;
    readonly next: MiddlewareNext<TContribution>;
}
export type MiddlewareHandler<TInputContext, TContribution, TDefinitionSources extends ErrorDefinitionMap> = (args: MiddlewareHandlerArgs<TInputContext, TContribution, TDefinitionSources>) => MaybePromise<Result<unknown, ErrorUnion<TDefinitionSources>> | MiddlewareNextResult>;
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
export interface MiddlewareTypes<TInputContext, TOutputContext, TDefinitionSources extends ErrorDefinitionMap, TDependencies extends readonly AnyMiddlewareTypes[] = readonly [], TWritesHeaders extends boolean = false, TProvidedContext = TOutputContext, TOwnDefinitionSources extends ErrorDefinitionMap = TDefinitionSources> {
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
export type MiddlewareTypesOf<TMiddleware> = TMiddleware extends Middleware<infer TTypes> ? TTypes : never;
/**
 * One immediate dependency edge. Its own ancestry is a runtime graph fact and
 * is deliberately not copied recursively into every downstream type record.
 */
export type MiddlewareDependencyTypes<TTypes extends AnyMiddlewareTypes> = MiddlewareTypes<TTypes["inputContext"], TTypes["outputContext"], TTypes["definitionSources"], readonly [], TTypes["writesHeaders"], TTypes["providedContext"], TTypes["ownDefinitionSources"]>;
/** Construction state for a middleware before its handler closes the builder. */
export interface MiddlewareBuilderTypes<TInputContext, TContext, TAddedContext, TDefinitionSources extends ErrorDefinitionMap, TDependencies extends readonly AnyMiddlewareTypes[] = readonly [], TWritesHeaders extends boolean = false, TProvidedContext = {}, TOwnDefinitionSources extends ErrorDefinitionMap = never> {
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
export type WithMiddlewareDefinitions<TTypes extends AnyMiddlewareBuilderTypes, TNewDefinitions extends ErrorDefinitionMap> = MiddlewareBuilderTypes<TTypes["inputContext"], TTypes["context"], TTypes["addedContext"], MergeDefinitionSources<TTypes["definitionSources"], TNewDefinitions>, TTypes["dependencies"], TTypes["writesHeaders"], TTypes["providedContext"], MergeDefinitionSources<TTypes["ownDefinitionSources"], TNewDefinitions>>;
export type WithMiddlewareHeaders<TTypes extends AnyMiddlewareBuilderTypes> = MiddlewareBuilderTypes<TTypes["inputContext"], TTypes["context"] & {
    readonly headers: Headers;
}, TTypes["addedContext"], TTypes["definitionSources"], TTypes["dependencies"], true, TTypes["providedContext"] & {
    readonly headers: Headers;
}, TTypes["ownDefinitionSources"]>;
export type WithMiddlewareDependency<TTypes extends AnyMiddlewareBuilderTypes, TDependency extends AnyMiddlewareTypes> = MiddlewareBuilderTypes<TTypes["inputContext"], TTypes["context"] & TDependency["providedContext"], TTypes["addedContext"], MergeDefinitionSources<TTypes["definitionSources"], TDependency["definitionSources"]>, readonly [...TTypes["dependencies"], MiddlewareDependencyTypes<TDependency>], BooleanOr<TTypes["writesHeaders"], TDependency["writesHeaders"]>, TTypes["providedContext"] & TDependency["providedContext"], TTypes["ownDefinitionSources"]>;
export type CompleteMiddlewareTypes<TTypes extends AnyMiddlewareBuilderTypes> = MiddlewareTypes<TTypes["inputContext"], TTypes["inputContext"] & TTypes["providedContext"] & TTypes["addedContext"], TTypes["definitionSources"], TTypes["dependencies"], TTypes["writesHeaders"], TTypes["providedContext"] & TTypes["addedContext"], TTypes["ownDefinitionSources"]>;
export type MiddlewareContextCompatibility<TAvailable, TRequired> = [TAvailable] extends [TRequired] ? unknown : RpcConstraintError<"middleware-requires-incompatible-context", {
    readonly available: TAvailable;
    readonly required: TRequired;
}>;
export declare class MiddlewareBuilder<TTypes extends AnyMiddlewareBuilderTypes> {
    private readonly definitions;
    private readonly ownDefinitions;
    private readonly dependencies;
    private readonly declaresHeaders;
    constructor(definitions?: ErrorDefinitionMap, ownDefinitions?: ErrorDefinitionMap, dependencies?: readonly RuntimeMiddleware[], declaresHeaders?: boolean);
    errors<const TNewDefinitions extends ErrorDefinitionMap>(definitions: TNewDefinitions & DefinitionSourcesCompatibility<TTypes["definitionSources"], NoInfer<TNewDefinitions>>): MiddlewareBuilder<WithMiddlewareDefinitions<TTypes, TNewDefinitions>>;
    /**
     * Declares that this middleware writes response headers — a rotated session
     * cookie, a rate-limit header. Adds `context.headers` for the handler, and
     * every procedure that `.use()`s it must declare `.headers()` too, exactly
     * as it must pre-declare the middleware's errors.
     */
    headers(): MiddlewareBuilder<WithMiddlewareHeaders<TTypes>>;
    /**
     * Declares a middleware this one depends on. The handler's input context
     * becomes the dependency's output context, the dependency's errors join this
     * middleware's union, and any `.use()` site pulls the dependency in
     * automatically — deduplicated by reference when several middleware share it.
     */
    after<TDependencyTypes extends AnyMiddlewareTypes>(dependency: Middleware<TDependencyTypes> & MiddlewareContextCompatibility<TTypes["context"], TDependencyTypes["inputContext"]>): MiddlewareBuilder<WithMiddlewareDependency<TTypes, TDependencyTypes>>;
    use(handler: MiddlewareHandler<TTypes["context"], TTypes["addedContext"], TTypes["ownDefinitionSources"]>): Middleware<CompleteMiddlewareTypes<TTypes>>;
}
/**
 * A subscription handler's arguments. `lastEventId` is the resume point the
 * client observed before this connection: `undefined` on a first connect, on
 * every reconnect of a procedure that did not declare `.resumable()`, and
 * whenever the client has not yet seen an event to derive one from.
 */
export interface SubscriptionHandlerArgs<TContext, TInput, TDefinitions extends ErrorDefinitionMap> extends ProcedureHandlerArgs<TContext, TInput, TDefinitions> {
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
export type ContractProcedureTypes<TRootContext, TInput, TOutput, TDefinitions extends ErrorDefinitionMap, TKind extends ProcedureKind, TCapability extends ProcedureCapability> = ProcedureTypes<TRootContext, TRootContext, TInput, TOutput, TDefinitions, TKind, TCapability>;
export type ExecutableProcedureTypes<TRootContext, TContext, TInput, TOutput, TDefinitions extends ErrorDefinitionMap, TKind extends ProcedureKind, TCapability extends ProcedureCapability> = ProcedureTypes<TRootContext, TContext, TInput, TOutput, TDefinitions, TKind, TCapability>;
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
    readonly handler: (args: ProcedureHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>) => MaybePromise<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>;
}
export interface Procedure<TTypes extends AnyProcedureTypes> extends ProcedureTypeCarrier<TTypes> {
    readonly _kind: "procedure";
    readonly _def: ProcedureManifest<TTypes>;
}
/** A query whose manifest proves the correlated list, cursor, and item types. */
export interface SubscriptionProcedureManifest<TTypes extends AnyProcedureTypes & {
    readonly kind: "subscription";
}> extends ProcedureContractManifest<TTypes> {
    readonly middlewares: readonly RuntimeMiddleware[];
    readonly handler: (args: SubscriptionHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>) => MaybePromise<AsyncIterable<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>>;
}
export interface SubscriptionProcedure<TTypes extends AnyProcedureTypes & {
    readonly kind: "subscription";
}> extends ProcedureTypeCarrier<TTypes> {
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
        readonly resumable?: {
            readonly eventId: (value: never) => string;
        };
        readonly middlewares: readonly RuntimeMiddleware[];
        readonly handler: (args: never) => unknown;
    };
}
export type AnyProcedure = AnyUnaryProcedure | AnySubscriptionProcedure;
export declare class ProcedureBuilder<TTypes extends AnyProcedureTypes> {
    private readonly declaration;
    private readonly middlewares;
    constructor(declaration: ProcedureDeclaration<TTypes>, middlewares?: readonly RuntimeMiddleware[]);
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
    headers(): ProcedureBuilder<WithProcedureHeaders<TTypes>>;
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
    }): ProcedureBuilder<WithProcedureResumable<TTypes>>;
    /**
     * Declares the entity this mutation writes when the output doesn't carry
     * it. Invalidation-only: returning the entity instead earns in-place
     * patches everywhere it appears.
     */
    writes<TModel extends AnyModel>(model: TModel, map: (input: TTypes["input"]) => ModelKeyInput<TModel>): ProcedureBuilder<WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>>;
    /**
     * Declares that this mutation invalidates a query on success. `map` turns
     * the mutation's input into the target query's input; omit it to invalidate
     * every cached input of that query. Executed automatically by the client
     * cache — call sites need no `onSettled`.
     */
    affects<const TTarget extends QueryAffectsTarget>(target: TTarget, map?: (input: TTypes["input"]) => ProcedureAffectsInput<TTarget>): ProcedureBuilder<WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>>;
    input<TNewInput, TEncoded extends WireValue>(this: ProcedureBuilder<TTypes> & ProcedureInputConstraint<TTypes>, codec: WireCodec<TNewInput, TEncoded>): ProcedureBuilder<WithProcedureInput<TTypes, TNewInput>>;
    output<TNewOutput, TEncoded extends WireValue>(codec: WireCodec<TNewOutput, TEncoded>): ProcedureBuilder<WithProcedureOutput<TTypes, TNewOutput>>;
    errors<const TNewDefinitions extends ErrorDefinitionMap>(definitions: TNewDefinitions & DefinitionMapCompatibility<TTypes["definitions"], NoInfer<TNewDefinitions>>): ProcedureBuilder<WithProcedureDefinitions<TTypes, MergeDefinitionMaps<TTypes["definitions"], TNewDefinitions>>>;
    use<TMiddlewareTypes extends AnyMiddlewareTypes>(middleware: Middleware<TMiddlewareTypes> & MiddlewareContextCompatibility<TTypes["context"], TMiddlewareTypes["inputContext"]> & DefinitionSourcesCompatibility<TTypes["definitions"], NoInfer<TMiddlewareTypes["definitionSources"]>>): ProcedureBuilder<WithProcedureMiddleware<TTypes, TMiddlewareTypes["outputContext"], MergeDefinitionMaps<TTypes["definitions"], MaterializeDefinitionSources<TMiddlewareTypes["definitionSources"]>>, BooleanOr<TTypes["writesHeaders"], TMiddlewareTypes["writesHeaders"]>>>;
    query(this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">): ProcedureContract<ContractProcedureTypes<TTypes["rootContext"], TTypes["input"], TTypes["output"], TTypes["definitions"], "query", UnaryProcedureCapability<TTypes["writesHeaders"]>>>;
    query(this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">, handler: (args: ProcedureHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>) => MaybePromise<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>): Procedure<CompleteProcedureTypes<TTypes, "query", UnaryProcedureCapability<TTypes["writesHeaders"]>>>;
    mutation(this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "mutation">): ProcedureContract<ContractProcedureTypes<TTypes["rootContext"], TTypes["input"], TTypes["output"], TTypes["definitions"], "mutation", UnaryProcedureCapability<TTypes["writesHeaders"]>>>;
    mutation(this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "mutation">, handler: (args: ProcedureHandlerArgs<TTypes["context"], TTypes["input"], TTypes["definitions"]>) => MaybePromise<Result<TTypes["output"], ErrorUnion<TTypes["definitions"]>>>): Procedure<CompleteProcedureTypes<TTypes, "mutation", UnaryProcedureCapability<TTypes["writesHeaders"]>>>;
    subscription(this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "subscription">): ProcedureContract<ContractProcedureTypes<TTypes["rootContext"], TTypes["input"], TTypes["output"], TTypes["definitions"], "subscription", UnaryProcedureCapability<TTypes["writesHeaders"]>>>;
    /**
     * Finishes a paginated query. `.output()` declares the ROW codec; this
     * builds the page envelope (`{ items, nextCursor }`) and splits the wire
     * input into `{ list, cursor }` — list identity vs position — so the
     * client engine keys ONE cache entry per list and threads cursors itself.
     * Still a query on the wire: batching, digests, `.affects()` targeting,
     * and entity patches all apply unchanged.
     */
    paginate<TCursor>(this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">, options: {
        readonly cursor: WireCodec<TCursor, WireValue>;
    }): ProcedureContract<ContractProcedureTypes<TTypes["rootContext"], PageRequest<TTypes["input"], TCursor>, Page<TTypes["output"], TCursor>, TTypes["definitions"], "query", PaginatedProcedureCapability<TTypes["input"], TCursor, TTypes["output"], TTypes["writesHeaders"]>>>;
    paginate<TCursor>(this: ProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">, options: {
        readonly cursor: WireCodec<TCursor, WireValue>;
    }, handler: (args: ProcedureHandlerArgs<TTypes["context"], PageRequest<TTypes["input"], TCursor>, TTypes["definitions"]>) => MaybePromise<Result<Page<TTypes["output"], TCursor>, ErrorUnion<TTypes["definitions"]>>>): Procedure<CompleteProcedureTypes<TTypes, "query", PaginatedProcedureCapability<TTypes["input"], TCursor, TTypes["output"], TTypes["writesHeaders"]>, PageRequest<TTypes["input"], TCursor>, Page<TTypes["output"], TCursor>>>;
    private finishContract;
    private finish;
}
export type UndeclaredMiddlewareErrors<TDeclared extends ErrorDefinitionMap, TContributed extends ErrorDefinitionMap> = Exclude<ErrorUnion<TContributed>, ErrorUnion<TDeclared>>;
export type MiddlewareContractCompatibility<TDeclared extends ErrorDefinitionMap, TCapability extends ProcedureCapability, TContributed extends ErrorDefinitionMap, TWritesHeaders extends boolean> = [UndeclaredMiddlewareErrors<TDeclared, TContributed>] extends [never] ? TWritesHeaders extends true ? TCapability["writesHeaders"] extends true ? unknown : RpcConstraintError<"middleware-writes-headers-but-contract-does-not", true> : unknown : RpcConstraintError<"middleware-errors-missing-from-contract", UndeclaredMiddlewareErrors<TDeclared, TContributed>["_tag"]>;
export type ProcedureImplementationMiddlewareConstraint<TContractTypes extends AnyProcedureTypes, TContext, TMiddlewareTypes extends AnyMiddlewareTypes> = MiddlewareContextCompatibility<TContext, TMiddlewareTypes["inputContext"]> & MiddlewareContractCompatibility<TContractTypes["definitions"], TContractTypes["capability"], TMiddlewareTypes["definitionSources"], TMiddlewareTypes["writesHeaders"]>;
export type ImplementedProcedureTypes<TContractTypes extends AnyProcedureTypes, TContext, TKind extends ProcedureKind = TContractTypes["kind"]> = ProcedureTypes<TContractTypes["rootContext"], TContext, TContractTypes["input"], TContractTypes["output"], TContractTypes["definitions"], TKind, TContractTypes["capability"]>;
export type ImplementationContext<TRootContext, TContractTypes extends AnyProcedureTypes> = TContractTypes["writesHeaders"] extends true ? TRootContext & {
    readonly headers: Headers;
} : TRootContext;
export type ProcedureImplementationContextConstraint<TRootContext, TContractTypes extends AnyProcedureTypes> = [Exclude<TRootContext, TContractTypes["rootContext"]>] extends [never] ? unknown : RpcConstraintError<"procedure-contract-requires-incompatible-context", {
    readonly available: TRootContext;
    readonly required: TContractTypes["rootContext"];
}>;
export declare class ProcedureImplementer<TContractTypes extends AnyProcedureTypes, TContext> {
    private readonly contract;
    private readonly middlewares;
    constructor(contract: ProcedureContract<TContractTypes>, middlewares?: readonly RuntimeMiddleware[]);
    use<TMiddlewareTypes extends AnyMiddlewareTypes>(middleware: Middleware<TMiddlewareTypes> & ProcedureImplementationMiddlewareConstraint<TContractTypes, TContext, NoInfer<TMiddlewareTypes>>): ProcedureImplementer<TContractTypes, ImplementationContext<TMiddlewareTypes["outputContext"], TContractTypes>>;
    handler(this: TContractTypes["kind"] extends "subscription" ? never : ProcedureImplementer<TContractTypes, TContext>, handler: (args: ProcedureHandlerArgs<TContext, TContractTypes["input"], TContractTypes["definitions"]>) => MaybePromise<Result<TContractTypes["output"], ErrorUnion<TContractTypes["definitions"]>>>): Procedure<ImplementedProcedureTypes<TContractTypes, TContext, Extract<TContractTypes["kind"], "query" | "mutation">>>;
    stream(this: TContractTypes["kind"] extends "subscription" ? ProcedureImplementer<TContractTypes, TContext> : never, handler: (args: SubscriptionHandlerArgs<TContext, TContractTypes["input"], TContractTypes["definitions"]>) => MaybePromise<AsyncIterable<Result<TContractTypes["output"], ErrorUnion<TContractTypes["definitions"]>>>>): SubscriptionProcedure<ImplementedProcedureTypes<TContractTypes, TContext, "subscription">>;
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
    readonly [TKey in keyof TRecord]: TRecord[TKey] extends AnyProcedure ? TRootContext extends ProcedureRootContext<TRecord[TKey]> ? TRecord[TKey] : RpcConstraintError<"router-procedure-requires-incompatible-context", {
        readonly available: TRootContext;
        readonly required: ProcedureRootContext<TRecord[TKey]>;
    }> : TRecord[TKey] extends RouterRecord ? ContextCompatibleRouterRecord<TRootContext, TRecord[TKey]> : never;
};
export type ContextCompatibleContractRecord<TRootContext, TRecord extends ContractRouterRecord> = {
    readonly [TKey in keyof TRecord]: TRecord[TKey] extends AnyProcedureContract ? TRootContext extends ProcedureRootContext<TRecord[TKey]> ? TRecord[TKey] : RpcConstraintError<"router-procedure-requires-incompatible-context", {
        readonly available: TRootContext;
        readonly required: ProcedureRootContext<TRecord[TKey]>;
    }> : TRecord[TKey] extends ContractRouterRecord ? ContextCompatibleContractRecord<TRootContext, TRecord[TKey]> : never;
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
export interface RpcFactory<TRootContext> extends RpcFactoryTypeCarrier<RpcFactoryTypes<TRootContext>> {
    procedure(): ProcedureBuilder<ProcedureTypes<TRootContext, TRootContext, EmptyObject, never, {}, ProcedureKind, UnaryProcedureCapability>>;
    middleware<TAddedContext = {}>(): MiddlewareBuilder<MiddlewareBuilderTypes<TRootContext, TRootContext, TAddedContext, never>>;
    router<const TRecord extends RouterRecord>(record: TRecord & ContextCompatibleRouterRecord<TRootContext, TRecord>): Router<RouterTypes<TRootContext, TRecord>>;
    contract<const TRecord extends ContractRouterRecord>(record: TRecord & ContextCompatibleContractRecord<TRootContext, TRecord>): RouterContract<RouterTypes<TRootContext, TRecord>> & TRecord;
    implement<TContractTypes extends AnyProcedureTypes>(contract: ProcedureContract<TContractTypes> & ProcedureImplementationContextConstraint<TRootContext, TContractTypes>): ProcedureImplementer<TContractTypes, ImplementationContext<TRootContext, TContractTypes>>;
}
export declare const rpc: RpcFactory<unknown> & {
    context: <TRootContext>() => RpcFactory<TRootContext>;
};
export { assertDefinitionsCanMerge } from "../error-map.js";
export declare const assertDefinitionsAreDeclared: (declared: ErrorDefinitionMap, contributed: ErrorDefinitionMap) => void;
export declare function executeProcedure<TRootContext, TInput, TOutput, TDefinitions extends ErrorDefinitionMap, TKind extends "query" | "mutation">(procedure: Procedure<ExecutableProcedureTypes<TRootContext, unknown, TInput, TOutput, TDefinitions, TKind, ProcedureCapability>>, input: TInput, options: ExecutionOptions<TRootContext>): Promise<Result<TOutput, ErrorUnion<TDefinitions> | ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest>>>;
export declare function executeProcedure(procedure: AnyUnaryProcedure, input: unknown, options: ExecutionOptions<unknown>): Promise<Result<unknown, AnyTaggedError | ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest>>>;
export declare function executeSubscription<TRootContext, TInput, TOutput, TDefinitions extends ErrorDefinitionMap>(procedure: SubscriptionProcedure<ExecutableProcedureTypes<TRootContext, unknown, TInput, TOutput, TDefinitions, "subscription", UnaryProcedureCapability>>, input: TInput, options: ExecutionOptions<TRootContext>): AsyncGenerator<Result<TOutput, ErrorUnion<TDefinitions> | ReturnType<typeof ServerInternal> | ReturnType<typeof ServerBadRequest>>>;
export declare function executeSubscription(procedure: AnySubscriptionProcedure, input: unknown, options: ExecutionOptions<unknown>): AsyncGenerator<Result<unknown, AnyTaggedError>>;
export type RouterTypesOf<TRouter> = TRouter extends Router<infer TTypes> ? TTypes : TRouter extends RouterContract<infer TTypes> ? TTypes : never;
export type RouterContext<TRouter> = RouterTypesOf<TRouter>["rootContext"];
export type RouterRecordOf<TRouter> = RouterTypesOf<TRouter>["record"];
export type HasDef = AnyProcedure | AnyProcedureContract;
export type MapRecord<TRecord, TProject> = {
    readonly [TKey in keyof TRecord]: TRecord[TKey] extends HasDef ? TProject extends "input" ? ProcedureInput<TRecord[TKey]> : TProject extends "output" ? ProcedureOutput<TRecord[TKey]> : ProcedureError<TRecord[TKey]> : MapRecord<TRecord[TKey], TProject>;
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

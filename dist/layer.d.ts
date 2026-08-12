import type { Result } from "./result.js";
import { type AnyWireCodec, type WireCodec, type WireValue } from "./wire.js";
import { type DefinitionMapCompatibility, type ErrorDefinitionMap, type ErrorUnion, type MaterializeDefinitionSources, type MergeDefinitionMaps, type MergeDefinitionSources } from "./error-map.js";
import type { Middleware, AnyMiddlewareTypes, MiddlewareTypes, MiddlewareDependencyTypes, Procedure, ProcedureContract, ProcedureImplementationMiddlewareConstraint, ProcedureTypes, RpcFactory } from "./server/contract.js";
import type { RpcConstraintError } from "./type-diagnostics.js";
import type { RpcFactoryTypeCarrier, RpcFactoryTypes } from "./factory-types.js";
import type { UnaryProcedureCapability } from "./procedure-capability.js";
import type { MaybePromise } from "./types.js";
export type LayerContext<TContext, TKey extends string, TValue> = TContext & {
    readonly [K in TKey]: TValue;
};
export type LayerQueryTypes<TContext, TValue, TDefinitions extends ErrorDefinitionMap> = ProcedureTypes<TContext, TContext, {}, TValue, TDefinitions, "query", UnaryProcedureCapability>;
export type LayerQueryContract<TContext, TValue, TDefinitions extends ErrorDefinitionMap> = ProcedureContract<LayerQueryTypes<TContext, TValue, TDefinitions>>;
export type LayerQueryProcedure<TContext, TKey extends string, TValue, TDefinitions extends ErrorDefinitionMap> = Procedure<ProcedureTypes<TContext, LayerContext<TContext, TKey, TValue>, {}, TValue, TDefinitions, "query", UnaryProcedureCapability>>;
export type LayerMiddleware<TContext, TKey extends string, TValue, TDefinitions extends ErrorDefinitionMap, TDependencies extends readonly AnyMiddlewareTypes[] = readonly [], TDefinitionSources extends ErrorDefinitionMap = TDefinitions, TOwnDefinitionSources extends ErrorDefinitionMap = TDefinitionSources> = Middleware<MiddlewareTypes<TContext, LayerContext<TContext, TKey, TValue>, TDefinitionSources, TDependencies, false, {
    readonly [K in TKey]: TValue;
}, TOwnDefinitionSources>>;
export type IncompatibleDefinitionKeys<TExpected extends ErrorDefinitionMap, TActual extends ErrorDefinitionMap> = {
    [TKey in keyof TExpected & keyof TActual]: TExpected[TKey] extends TActual[TKey] ? TActual[TKey] extends TExpected[TKey] ? never : TKey : TKey;
}[keyof TExpected & keyof TActual];
export type MissingDefinitionKeys<TExpected extends ErrorDefinitionMap, TActual extends ErrorDefinitionMap> = Exclude<keyof TExpected, keyof TActual> | IncompatibleDefinitionKeys<TExpected, TActual>;
export type ExtraDefinitionKeys<TExpected extends ErrorDefinitionMap, TActual extends ErrorDefinitionMap> = Exclude<keyof TActual, keyof TExpected> | IncompatibleDefinitionKeys<TExpected, TActual>;
export type MiddlewareConstraint<TMiddleware, TContext, TKey extends string, TValue, TContractDefinitions extends ErrorDefinitionMap> = TMiddleware extends Middleware<infer TMiddlewareTypes> ? TMiddlewareTypes extends MiddlewareTypes<infer TInputContext, infer TOutputContext, infer TMiddlewareDefinitions, readonly AnyMiddlewareTypes[], infer TWritesHeaders, unknown> ? TContext extends TInputContext ? TOutputContext extends LayerContext<TContext, TKey, TValue> ? [
    MissingDefinitionKeys<TContractDefinitions, MaterializeDefinitionSources<TMiddlewareDefinitions>>
] extends [never] ? [
    ExtraDefinitionKeys<TContractDefinitions, MaterializeDefinitionSources<TMiddlewareDefinitions>>
] extends [never] ? TWritesHeaders extends false ? unknown : RpcConstraintError<"layer-middleware-writes-headers", true> : RpcConstraintError<"layer-middleware-has-extra-errors", ExtraDefinitionKeys<TContractDefinitions, MaterializeDefinitionSources<TMiddlewareDefinitions>>> : RpcConstraintError<"layer-middleware-is-missing-errors", MissingDefinitionKeys<TContractDefinitions, MaterializeDefinitionSources<TMiddlewareDefinitions>>> : RpcConstraintError<"layer-middleware-does-not-provide-value", {
    readonly expected: LayerContext<TContext, TKey, TValue>;
    readonly actual: TOutputContext;
}> : RpcConstraintError<"layer-middleware-requires-incompatible-context", {
    readonly available: TContext;
    readonly required: TInputContext;
}> : RpcConstraintError<"layer-procedure-requires-middleware", TMiddleware> : RpcConstraintError<"layer-procedure-requires-middleware", TMiddleware>;
export type CheckedLayerMiddleware<TMiddlewareTypes extends AnyMiddlewareTypes, TContext, TKey extends string, TValue, TDefinitions extends ErrorDefinitionMap> = Middleware<TMiddlewareTypes> & LayerMiddlewareView<TMiddlewareTypes, TContext, TKey, TValue> & MiddlewareConstraint<Middleware<TMiddlewareTypes>, TContext, TKey, TValue, TDefinitions> & ProcedureImplementationMiddlewareConstraint<LayerQueryTypes<TContext, TValue, TDefinitions>, TContext, TMiddlewareTypes>;
/**
 * The middleware view proven by the layer constraint. Keeping this as an
 * intersection lets `.use()` consume the proved output context directly;
 * diagnostics still retain the middleware's original associated record.
 */
export type LayerMiddlewareView<TMiddlewareTypes extends AnyMiddlewareTypes, TContext, TKey extends string, TValue> = Middleware<MiddlewareTypes<TContext, LayerContext<TContext, TKey, TValue>, TMiddlewareTypes["definitionSources"], TMiddlewareTypes["dependencies"], TMiddlewareTypes["writesHeaders"], TMiddlewareTypes["providedContext"], TMiddlewareTypes["ownDefinitionSources"]>>;
/** Contract-builder slice used by layers on either side of the server boundary. */
export interface LayerContractFactory<TContext> extends RpcFactoryTypeCarrier<RpcFactoryTypes<TContext>> {
    procedure(): {
        input<TInput, TInputData extends WireValue>(codec: WireCodec<TInput, TInputData>): {
            output<TOutput, TOutputData extends WireValue>(codec: WireCodec<TOutput, TOutputData>): {
                errors<const TDefinitions extends ErrorDefinitionMap>(definitions: TDefinitions): {
                    query(): ProcedureContract<ProcedureTypes<TContext, TContext, TInput, TOutput, TDefinitions, "query", UnaryProcedureCapability>>;
                };
            };
        };
    };
}
/**
 * The structural surface shared by base and refined layers: enough to derive a
 * client shell without caring how the server half is built.
 */
export interface AnyLayer {
    readonly $layer: true;
    readonly name: string;
    readonly key: string;
    readonly provides: AnyWireCodec;
    readonly errors: ErrorDefinitionMap;
}
export interface LayerShape<TKey extends string, TValue, TDefinitions extends ErrorDefinitionMap> extends AnyLayer {
    readonly key: TKey;
    readonly provides: WireCodec<TValue, WireValue>;
    readonly errors: TDefinitions;
}
/**
 * A layer is one shared declaration of a precondition: the value it guarantees,
 * the errors that occur while establishing it, and the context key it occupies.
 *
 * From it, three artifacts derive without drift:
 * - `layer.middleware(app, resolve)` — server middleware that adds the value to
 *   context and contributes the layer's error union;
 * - `layer.contract(app)` — the context procedure: a query from `{}` to the
 *   guaranteed value with the same union, safe to place in the shared contract;
 * - `layerShell(layer, ...)` (from `result-rpc/react`) — the client layer that
 *   loads the value through the context procedure, provides it, and claims the
 *   same union.
 */
export interface Layer<TName extends string, TKey extends string, TValue, TDefinitions extends ErrorDefinitionMap> extends LayerShape<TKey, TValue, TDefinitions> {
    readonly name: TName;
    /**
     * Server middleware. `resolve` produces the guaranteed value or one of the
     * layer's declared errors; on success the value is added to context under
     * `key` for everything downstream.
     */
    middleware<TContext>(app: RpcFactory<TContext>, resolve: (args: {
        readonly context: TContext;
        readonly errors: TDefinitions;
    }) => MaybePromise<Result<TValue, ErrorUnion<TDefinitions>>>): LayerMiddleware<TContext, TKey, TValue, TDefinitions>;
    /** The context procedure's shared contract: `{} -> value` with the layer union. */
    contract<TContext>(app: LayerContractFactory<TContext>): LayerQueryContract<TContext, TValue, TDefinitions>;
    /**
     * The context procedure, implemented from the layer's middleware chain. The
     * handler is derived — it returns the value the middleware placed in
     * context — so the procedure cannot disagree with the middleware about
     * either the value or the union.
     */
    procedure<TContext, TMiddlewareTypes extends AnyMiddlewareTypes>(app: RpcFactory<TContext>, middleware: CheckedLayerMiddleware<TMiddlewareTypes, NoInfer<TContext>, TKey, TValue, TDefinitions>): LayerQueryProcedure<TContext, TKey, TValue, TDefinitions>;
    /** Implements a shared context-procedure contract with this layer's middleware. */
    implement<TContext, TContractDefinitions extends TDefinitions, TMiddlewareTypes extends AnyMiddlewareTypes>(app: RpcFactory<TContext>, contract: LayerQueryContract<NoInfer<TContext>, TValue, TContractDefinitions>, middleware: CheckedLayerMiddleware<TMiddlewareTypes, NoInfer<TContext>, TKey, TValue, TContractDefinitions>): LayerQueryProcedure<TContext, TKey, TValue, TContractDefinitions>;
    /**
     * Derives a layer that narrows this layer's value. The classic case: an
     * optional session layer provides `viewer: User | null` from a cookie, and a
     * required layer refines it to `User`, contributing the union that occurs
     * when the refinement fails. The refined middleware reads the parent value
     * from context and replaces it under the same key, so context grows and
     * narrows monotonically through the chain.
     */
    require<const TNewName extends string, TRefined extends TValue, TNewData extends WireValue, const TNewDefinitions extends ErrorDefinitionMap>(options: {
        readonly name: TNewName;
        readonly provides: WireCodec<TRefined, TNewData>;
        readonly errors: TNewDefinitions;
        readonly refine: (args: {
            readonly value: TValue;
            readonly errors: TNewDefinitions;
        }) => MaybePromise<Result<TRefined, ErrorUnion<TNewDefinitions>>>;
    } & DefinitionMapCompatibility<TDefinitions, NoInfer<TNewDefinitions>>): RequiredLayer<TNewName, TKey, TValue, TRefined, TDefinitions, TNewDefinitions>;
}
/**
 * A layer derived by narrowing another layer's value. Its middleware needs no
 * resolver: it reads the parent value from context and refines it in place.
 */
export interface RequiredLayer<TName extends string, TKey extends string, TParentValue, TValue extends TParentValue, TParentDefinitions extends ErrorDefinitionMap, TDefinitions extends ErrorDefinitionMap> extends LayerShape<TKey, TValue, TDefinitions> {
    readonly name: TName;
    /**
     * Middleware that narrows the parent value in place. The parent middleware
     * is composed with `.after()`: any `.use()` site pulls the whole chain in
     * dependency order, deduplicated by reference.
     */
    middleware<TContext, TAfterDefinitions extends ErrorDefinitionMap, TAfterDependencies extends readonly AnyMiddlewareTypes[], TAfterDefinitionSources extends ErrorDefinitionMap, TAfterOwnDefinitionSources extends ErrorDefinitionMap>(app: RpcFactory<TContext>, after: LayerMiddleware<TContext, TKey, TParentValue, TAfterDefinitions, TAfterDependencies, TAfterDefinitionSources, TAfterOwnDefinitionSources>): LayerMiddleware<TContext, TKey, TValue, MergeDefinitionMaps<TAfterDefinitions, TDefinitions>, readonly [
        MiddlewareDependencyTypes<MiddlewareTypes<TContext, LayerContext<TContext, TKey, TParentValue>, TAfterDefinitionSources, TAfterDependencies, false, {
            readonly [K in TKey]: TParentValue;
        }, TAfterOwnDefinitionSources>>
    ], MergeDefinitionSources<TAfterDefinitionSources, TDefinitions>, TDefinitions>;
    contract<TContext>(app: LayerContractFactory<TContext>): LayerQueryContract<TContext, TValue, MergeDefinitionMaps<TParentDefinitions, TDefinitions>>;
    /**
     * The context procedure takes the single composed middleware.
     */
    procedure<TContext, TMiddlewareTypes extends AnyMiddlewareTypes>(app: RpcFactory<TContext>, middleware: CheckedLayerMiddleware<TMiddlewareTypes, NoInfer<TContext>, TKey, TValue, MergeDefinitionMaps<TParentDefinitions, TDefinitions>>): LayerQueryProcedure<TContext, TKey, TValue, MergeDefinitionMaps<TParentDefinitions, TDefinitions>>;
    implement<TContext, TContractDefinitions extends MergeDefinitionMaps<TParentDefinitions, TDefinitions>, TMiddlewareTypes extends AnyMiddlewareTypes>(app: RpcFactory<TContext>, contract: LayerQueryContract<NoInfer<TContext>, TValue, TContractDefinitions>, middleware: CheckedLayerMiddleware<TMiddlewareTypes, NoInfer<TContext>, TKey, TValue, TContractDefinitions>): LayerQueryProcedure<TContext, TKey, TValue, TContractDefinitions>;
}
export type LayerValue<TLayer> = TLayer extends LayerShape<string, infer TValue, ErrorDefinitionMap> ? TValue : never;
export type LayerErrors<TLayer> = TLayer extends LayerShape<string, infer _TValue, infer TDefinitions> ? TDefinitions : never;
export interface DefineLayerOptions<TName extends string, TKey extends string, TValue, TData extends WireValue, TDefinitions extends ErrorDefinitionMap> {
    /** Used for shell diagnostics and devtools. */
    readonly name: TName;
    /** The context property the middleware adds and the shell value represents. */
    readonly key: TKey;
    /** Wire codec for the guaranteed value. */
    readonly provides: WireCodec<TValue, TData>;
    /** The errors that can occur while establishing the layer. */
    readonly errors: TDefinitions;
}
export declare const defineLayer: <const TName extends string, const TKey extends string, TValue, TData extends WireValue, const TDefinitions extends ErrorDefinitionMap>(options: DefineLayerOptions<TName, TKey, TValue, TData, TDefinitions>) => Layer<TName, TKey, TValue, TDefinitions>;

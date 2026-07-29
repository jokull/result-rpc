import type { Result } from "./result.js";
import { err, ok } from "./result.js";
import { wire, type WireCodec, type WireValue } from "./wire.js";
import {
  mergeDefinitionMaps,
  widenDefinitionError,
  type DefinitionMapCompatibility,
  type ErrorDefinitionMap,
  type ErrorUnion,
  type MergeDefinitionMaps,
} from "./error-map.js";
import type { Middleware, Procedure, ProcedureContract, RpcFactory } from "./server/contract.js";

type MaybePromise<T> = T | Promise<T>;

type LayerContext<TContext, TKey extends string, TValue> = TContext & {
  readonly [K in TKey]: TValue;
};

type MiddlewareConstraint<
  TMiddleware,
  TContext,
  TKey extends string,
  TValue,
  TContractDefinitions extends ErrorDefinitionMap,
> =
  TMiddleware extends Middleware<
    infer TInputContext,
    infer TOutputContext,
    infer TMiddlewareDefinitions
  >
    ? TContext extends TInputContext
      ? TOutputContext extends LayerContext<TContext, TKey, TValue>
        ? TContractDefinitions extends TMiddlewareDefinitions
          ? unknown
          : never
        : never
      : never
    : never;

/** Contract-builder slice used by layers on either side of the server boundary. */
interface LayerContractFactory<TContext> {
  procedure(): {
    input<TInput, TInputData extends WireValue>(
      codec: WireCodec<TInput, TInputData>,
    ): {
      output<TOutput, TOutputData extends WireValue>(
        codec: WireCodec<TOutput, TOutputData>,
      ): {
        errors<const TDefinitions extends ErrorDefinitionMap>(
          definitions: TDefinitions,
        ): {
          query(): ProcedureContract<TContext, TInput, TOutput, TDefinitions, "query">;
        };
      };
    };
  };
}

/**
 * The structural surface shared by base and refined layers: enough to derive a
 * client shell without caring how the server half is built.
 */
export interface LayerShape<TKey extends string, TValue, TDefinitions extends ErrorDefinitionMap> {
  readonly $layer: true;
  readonly name: string;
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
export interface Layer<
  TName extends string,
  TKey extends string,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
> extends LayerShape<TKey, TValue, TDefinitions> {
  readonly name: TName;

  /**
   * Server middleware. `resolve` produces the guaranteed value or one of the
   * layer's declared errors; on success the value is added to context under
   * `key` for everything downstream.
   */
  middleware<TContext>(
    app: RpcFactory<TContext>,
    resolve: (args: {
      readonly context: TContext;
      readonly errors: TDefinitions;
    }) => MaybePromise<Result<TValue, ErrorUnion<TDefinitions>>>,
  ): Middleware<TContext, TContext & { readonly [K in TKey]: TValue }, TDefinitions>;

  /** The context procedure's shared contract: `{} -> value` with the layer union. */
  contract<TContext>(
    app: LayerContractFactory<TContext>,
  ): ProcedureContract<TContext, {}, TValue, TDefinitions, "query">;

  /**
   * The context procedure, implemented from the layer's middleware chain. The
   * handler is derived — it returns the value the middleware placed in
   * context — so the procedure cannot disagree with the middleware about
   * either the value or the union. Code-first routers pass just the chain;
   * contract-first routers pass the shared contract (from `layer.contract`)
   * ahead of it.
   */
  procedure<TContext, TMiddleware>(
    app: RpcFactory<TContext>,
    middleware: TMiddleware &
      MiddlewareConstraint<TMiddleware, TContext, TKey, TValue, TDefinitions>,
  ): Procedure<TContext, {}, TValue, TDefinitions, "query">;
  procedure<TContext, TContractDefinitions extends TDefinitions, TMiddleware>(
    app: RpcFactory<TContext>,
    contract: ProcedureContract<TContext, {}, TValue, TContractDefinitions, "query">,
    middleware: TMiddleware &
      MiddlewareConstraint<TMiddleware, TContext, TKey, TValue, TContractDefinitions>,
  ): Procedure<TContext, {}, TValue, TContractDefinitions, "query">;

  /**
   * Derives a layer that narrows this layer's value. The classic case: an
   * optional session layer provides `viewer: User | null` from a cookie, and a
   * required layer refines it to `User`, contributing the union that occurs
   * when the refinement fails. The refined middleware reads the parent value
   * from context and replaces it under the same key, so context grows and
   * narrows monotonically through the chain.
   */
  require<
    const TNewName extends string,
    TRefined extends TValue,
    TNewData extends WireValue,
    const TNewDefinitions extends ErrorDefinitionMap,
  >(
    options: {
      readonly name: TNewName;
      readonly provides: WireCodec<TRefined, TNewData>;
      readonly errors: TNewDefinitions;
      readonly refine: (args: {
        readonly value: TValue;
        readonly errors: TNewDefinitions;
      }) => MaybePromise<Result<TRefined, ErrorUnion<TNewDefinitions>>>;
    } & DefinitionMapCompatibility<TDefinitions, NoInfer<TNewDefinitions>>,
  ): RequiredLayer<TNewName, TKey, TValue, TRefined, TDefinitions, TNewDefinitions>;
}

/**
 * A layer derived by narrowing another layer's value. Its middleware needs no
 * resolver: it reads the parent value from context and refines it in place.
 */
export interface RequiredLayer<
  TName extends string,
  TKey extends string,
  TParentValue,
  TValue extends TParentValue,
  TParentDefinitions extends ErrorDefinitionMap,
  TDefinitions extends ErrorDefinitionMap,
> extends LayerShape<TKey, TValue, TDefinitions> {
  readonly name: TName;

  /**
   * Middleware that narrows the parent value in place. The parent middleware
   * is composed with `.after()`: any `.use()` site pulls the whole chain in
   * dependency order, deduplicated by reference.
   */
  middleware<TContext, TAfterDefinitions extends ErrorDefinitionMap>(
    app: RpcFactory<TContext>,
    after: Middleware<
      TContext,
      TContext & { readonly [K in TKey]: TParentValue },
      TAfterDefinitions
    >,
  ): Middleware<
    TContext,
    TContext & { readonly [K in TKey]: TValue },
    MergeDefinitionMaps<TAfterDefinitions, TDefinitions>
  >;

  contract<TContext>(
    app: LayerContractFactory<TContext>,
  ): ProcedureContract<
    TContext,
    {},
    TValue,
    MergeDefinitionMaps<TParentDefinitions, TDefinitions>,
    "query"
  >;

  /**
   * The context procedure takes the single composed middleware. Pass the
   * shared contract ahead of it when contract-first.
   */
  procedure<TContext, TMiddleware>(
    app: RpcFactory<TContext>,
    middleware: TMiddleware &
      MiddlewareConstraint<
        TMiddleware,
        TContext,
        TKey,
        TValue,
        MergeDefinitionMaps<TParentDefinitions, TDefinitions>
      >,
  ): Procedure<
    TContext,
    {},
    TValue,
    MergeDefinitionMaps<TParentDefinitions, TDefinitions>,
    "query"
  >;
  procedure<
    TContext,
    TContractDefinitions extends MergeDefinitionMaps<TParentDefinitions, TDefinitions>,
    TMiddleware,
  >(
    app: RpcFactory<TContext>,
    contract: ProcedureContract<TContext, {}, TValue, TContractDefinitions, "query">,
    middleware: TMiddleware &
      MiddlewareConstraint<TMiddleware, TContext, TKey, TValue, TContractDefinitions>,
  ): Procedure<TContext, {}, TValue, TContractDefinitions, "query">;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLayer = LayerShape<string, any, ErrorDefinitionMap>;

export type LayerValue<TLayer> =
  TLayer extends LayerShape<string, infer TValue, ErrorDefinitionMap> ? TValue : never;

export type LayerErrors<TLayer> =
  TLayer extends LayerShape<string, any, infer TDefinitions> ? TDefinitions : never;

export interface DefineLayerOptions<
  TName extends string,
  TKey extends string,
  TValue,
  TData extends WireValue,
  TDefinitions extends ErrorDefinitionMap,
> {
  /** Used for shell diagnostics and devtools. */
  readonly name: TName;
  /** The context property the middleware adds and the shell value represents. */
  readonly key: TKey;
  /** Wire codec for the guaranteed value. */
  readonly provides: WireCodec<TValue, TData>;
  /** The errors that can occur while establishing the layer. */
  readonly errors: TDefinitions;
}

function withLayerValue<TContext, const TKey extends string, TValue>(
  context: TContext,
  key: TKey,
  value: TValue,
): LayerContext<TContext, TKey, TValue>;
function withLayerValue(context: unknown, key: string, value: unknown): unknown {
  return Object.assign({}, context, { [key]: value });
}

const implementContextProcedure = <
  TContext,
  const TKey extends string,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
  TOutputContext extends LayerContext<TContext, TKey, TValue>,
  TMiddlewareDefinitions extends ErrorDefinitionMap,
>(
  app: RpcFactory<TContext>,
  contract: ProcedureContract<TContext, {}, TValue, TDefinitions, "query">,
  key: TKey,
  middleware: Middleware<TContext, TOutputContext, TMiddlewareDefinitions>,
): Procedure<TContext, {}, TValue, TDefinitions, "query"> =>
  app
    .implement(contract)
    // Public layer overloads already prove the middleware's context and error
    // obligations. This erased implementation cannot retain that conditional
    // proof after overload selection, so only this internal handoff is cast.
    .use(middleware as unknown as Middleware<TContext, TOutputContext, TDefinitions>)
    .handler(({ context }) => ok(context[key]));

export const defineLayer = <
  const TName extends string,
  const TKey extends string,
  TValue,
  TData extends WireValue,
  const TDefinitions extends ErrorDefinitionMap,
>(
  options: DefineLayerOptions<TName, TKey, TValue, TData, TDefinitions>,
): Layer<TName, TKey, TValue, TDefinitions> => {
  // An empty error map declares an optional layer: it always establishes
  // (e.g. `viewer: User | null` from a cookie) and claims nothing on the client.

  const layerMiddleware = <TContext>(
    app: RpcFactory<TContext>,
    resolve: (args: {
      readonly context: TContext;
      readonly errors: TDefinitions;
    }) => MaybePromise<Result<TValue, ErrorUnion<TDefinitions>>>,
  ): Middleware<TContext, LayerContext<TContext, TKey, TValue>, TDefinitions> =>
    app
      .middleware<{ readonly [K in TKey]: TValue }>()
      .errors(options.errors)
      .use(async ({ context, next }) => {
        const resolved = await resolve({ context, errors: options.errors });
        if (!resolved.ok) return resolved;
        return next({
          context: withLayerValue(context, options.key, resolved.value),
        });
      });

  const layerContract = <TContext>(
    app: LayerContractFactory<TContext>,
  ): ProcedureContract<TContext, {}, TValue, TDefinitions, "query"> =>
    app.procedure().input(wire.object({})).output(options.provides).errors(options.errors).query();

  function layerProcedure<TContext, TMiddleware>(
    app: RpcFactory<TContext>,
    middleware: TMiddleware &
      MiddlewareConstraint<TMiddleware, TContext, TKey, TValue, TDefinitions>,
  ): Procedure<TContext, {}, TValue, TDefinitions, "query">;
  function layerProcedure<TContext, TContractDefinitions extends TDefinitions, TMiddleware>(
    app: RpcFactory<TContext>,
    contract: ProcedureContract<TContext, {}, TValue, TContractDefinitions, "query">,
    middleware: TMiddleware &
      MiddlewareConstraint<TMiddleware, TContext, TKey, TValue, TContractDefinitions>,
  ): Procedure<TContext, {}, TValue, TContractDefinitions, "query">;
  function layerProcedure<
    TContext,
    TContractDefinitions extends ErrorDefinitionMap,
    TOutputContext extends LayerContext<TContext, TKey, TValue>,
    TMiddlewareDefinitions extends ErrorDefinitionMap,
  >(
    app: RpcFactory<TContext>,
    contractOrMiddleware:
      | ProcedureContract<TContext, {}, TValue, TContractDefinitions, "query">
      | Middleware<TContext, TOutputContext, TMiddlewareDefinitions>,
    middleware?: Middleware<TContext, TOutputContext, TMiddlewareDefinitions>,
  ): unknown {
    if (contractOrMiddleware._kind === "procedure-contract") {
      if (middleware === undefined) {
        throw new TypeError("A layer's context procedure requires its middleware");
      }
      return implementContextProcedure(app, contractOrMiddleware, options.key, middleware);
    }
    return implementContextProcedure(app, layerContract(app), options.key, contractOrMiddleware);
  }

  const layer: Layer<TName, TKey, TValue, TDefinitions> = {
    $layer: true,
    name: options.name,
    key: options.key,
    provides: options.provides,
    errors: options.errors,

    middleware: layerMiddleware,
    contract: layerContract,
    procedure: layerProcedure,

    require: <
      const TNewName extends string,
      TRefined extends TValue,
      TNewData extends WireValue,
      const TNewDefinitions extends ErrorDefinitionMap,
    >(
      refineOptions: {
        readonly name: TNewName;
        readonly provides: WireCodec<TRefined, TNewData>;
        readonly errors: TNewDefinitions;
        readonly refine: (args: {
          readonly value: TValue;
          readonly errors: TNewDefinitions;
        }) => MaybePromise<Result<TRefined, ErrorUnion<TNewDefinitions>>>;
      } & DefinitionMapCompatibility<TDefinitions, NoInfer<TNewDefinitions>>,
    ): RequiredLayer<TNewName, TKey, TValue, TRefined, TDefinitions, TNewDefinitions> => {
      if (Object.keys(refineOptions.errors).length === 0) {
        throw new TypeError(
          `Layer ${refineOptions.name} refines ${options.name} but declares no errors; a refinement that cannot fail is the parent layer`,
        );
      }
      const allDefinitions = mergeDefinitionMaps(options.errors, refineOptions.errors);

      const requiredMiddleware = <TContext, TAfterDefinitions extends ErrorDefinitionMap>(
        app: RpcFactory<TContext>,
        after: Middleware<TContext, LayerContext<TContext, TKey, TValue>, TAfterDefinitions> &
          DefinitionMapCompatibility<TNewDefinitions, NoInfer<TAfterDefinitions>>,
      ): Middleware<
        TContext,
        LayerContext<TContext, TKey, TRefined>,
        MergeDefinitionMaps<TAfterDefinitions, TNewDefinitions>
      > =>
        app
          .middleware<{ readonly [K in TKey]: TRefined }>()
          .after(after)
          .errors<TNewDefinitions>(
            refineOptions.errors as TNewDefinitions &
              DefinitionMapCompatibility<
                MergeDefinitionMaps<{}, TAfterDefinitions>,
                TNewDefinitions
              >,
          )
          .use(async ({ context, next }) => {
            const resolved = await refineOptions.refine({
              value: context[options.key],
              errors: refineOptions.errors,
            });
            if (!resolved.ok) {
              return err(
                widenDefinitionError<
                  TNewDefinitions,
                  MergeDefinitionMaps<TAfterDefinitions, TNewDefinitions>
                >(resolved.error),
              );
            }
            return next({
              context: withLayerValue(context, options.key, resolved.value),
            });
          });

      type TAllDefinitions = MergeDefinitionMaps<TDefinitions, TNewDefinitions>;

      const requiredContract = <TContext>(
        app: LayerContractFactory<TContext>,
      ): ProcedureContract<TContext, {}, TRefined, TAllDefinitions, "query"> =>
        app
          .procedure()
          .input(wire.object({}))
          .output(refineOptions.provides)
          .errors(allDefinitions)
          .query();

      function requiredProcedure<TContext, TMiddleware>(
        app: RpcFactory<TContext>,
        middleware: TMiddleware &
          MiddlewareConstraint<TMiddleware, TContext, TKey, TRefined, TAllDefinitions>,
      ): Procedure<TContext, {}, TRefined, TAllDefinitions, "query">;
      function requiredProcedure<
        TContext,
        TContractDefinitions extends TAllDefinitions,
        TMiddleware,
      >(
        app: RpcFactory<TContext>,
        contract: ProcedureContract<TContext, {}, TRefined, TContractDefinitions, "query">,
        middleware: TMiddleware &
          MiddlewareConstraint<TMiddleware, TContext, TKey, TRefined, TContractDefinitions>,
      ): Procedure<TContext, {}, TRefined, TContractDefinitions, "query">;
      function requiredProcedure<
        TContext,
        TContractDefinitions extends ErrorDefinitionMap,
        TOutputContext extends LayerContext<TContext, TKey, TRefined>,
        TMiddlewareDefinitions extends ErrorDefinitionMap,
      >(
        app: RpcFactory<TContext>,
        contractOrMiddleware:
          | ProcedureContract<TContext, {}, TRefined, TContractDefinitions, "query">
          | Middleware<TContext, TOutputContext, TMiddlewareDefinitions>,
        middleware?: Middleware<TContext, TOutputContext, TMiddlewareDefinitions>,
      ): unknown {
        if (contractOrMiddleware._kind === "procedure-contract") {
          if (middleware === undefined) {
            throw new TypeError("A layer's context procedure requires its middleware");
          }
          return implementContextProcedure(app, contractOrMiddleware, options.key, middleware);
        }
        return implementContextProcedure(
          app,
          requiredContract(app),
          options.key,
          contractOrMiddleware,
        );
      }

      const refined: RequiredLayer<
        typeof refineOptions.name,
        TKey,
        TValue,
        TRefined,
        TDefinitions,
        TNewDefinitions
      > = {
        $layer: true,
        name: refineOptions.name,
        key: options.key,
        provides: refineOptions.provides,
        errors: refineOptions.errors,

        middleware: requiredMiddleware,
        contract: requiredContract,
        procedure: requiredProcedure,
      };
      return Object.freeze(refined);
    },
  };

  return Object.freeze(layer);
};

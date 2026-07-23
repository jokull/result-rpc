import type { Result } from "./result.js";
import { ok } from "./result.js";
import { wire, type WireCodec, type WireValue } from "./wire.js";
import type {
  ErrorDefinitionMap,
  ErrorUnion,
  Middleware,
  Procedure,
  ProcedureContract,
  RpcFactory,
} from "./server/contract.js";

type MaybePromise<T> = T | Promise<T>;

/**
 * The structural surface shared by base and refined layers: enough to derive a
 * client shell without caring how the server half is built.
 */
export interface LayerShape<
  TKey extends string,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
> {
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
  ): Middleware<
    TContext,
    TContext & { readonly [K in TKey]: TValue },
    TDefinitions
  >;

  /** The context procedure's shared contract: `{} -> value` with the layer union. */
  contract<TContext>(
    app: RpcFactory<TContext>,
  ): ProcedureContract<TContext, {}, TValue, TDefinitions, "query">;

  /**
   * The context procedure, implemented from the layer's middleware chain. The
   * handler is derived — it returns the value the middleware placed in
   * context — so the procedure cannot disagree with the middleware about
   * either the value or the union. Code-first routers pass just the chain;
   * contract-first routers pass the shared contract (from `layer.contract`)
   * ahead of it.
   */
  procedure<TContext>(
    app: RpcFactory<TContext>,
    ...middlewares: readonly AnyMiddlewareLike[]
  ): Procedure<TContext, {}, TValue, TDefinitions, "query">;
  procedure<TContext>(
    app: RpcFactory<TContext>,
    contract: ProcedureContract<TContext, {}, TValue, TDefinitions, "query">,
    ...middlewares: readonly AnyMiddlewareLike[]
  ): Procedure<TContext, {}, TValue, TDefinitions, "query">;

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
  >(options: {
    readonly name: TNewName;
    readonly provides: WireCodec<TRefined, TNewData>;
    readonly errors: TNewDefinitions;
    readonly refine: (args: {
      readonly value: TValue;
      readonly errors: TNewDefinitions;
    }) => MaybePromise<Result<TRefined, ErrorUnion<TNewDefinitions>>>;
  }): RequiredLayer<TNewName, TKey, TValue, TRefined, TNewDefinitions>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMiddlewareLike = Middleware<any, any, any>;

/**
 * A layer derived by narrowing another layer's value. Its middleware needs no
 * resolver: it reads the parent value from context and refines it in place.
 */
export interface RequiredLayer<
  TName extends string,
  TKey extends string,
  TParentValue,
  TValue extends TParentValue,
  TDefinitions extends ErrorDefinitionMap,
> extends LayerShape<TKey, TValue, TDefinitions> {
  readonly name: TName;

  /**
   * Middleware that narrows the parent value in place. Pass the parent layer's
   * middleware as `after` to bundle it: any `.use()` site then pulls the whole
   * chain in dependency order, deduplicated by reference. Without `after`, the
   * input context must already carry the parent value.
   */
  middleware<TContext>(
    app: RpcFactory<TContext>,
  ): Middleware<
    TContext & { readonly [K in TKey]: TParentValue },
    TContext & { readonly [K in TKey]: TValue },
    TDefinitions
  >;
  middleware<TContext, TParentDefinitions extends ErrorDefinitionMap>(
    app: RpcFactory<TContext>,
    after: Middleware<
      TContext,
      TContext & { readonly [K in TKey]: TParentValue },
      TParentDefinitions
    >,
  ): Middleware<
    TContext,
    TContext & { readonly [K in TKey]: TValue },
    TDefinitions & TParentDefinitions
  >;

  contract<TContext>(
    app: RpcFactory<TContext>,
  ): ProcedureContract<TContext, {}, TValue, TDefinitions, "query">;

  /**
   * The context procedure. Pass the full middleware chain — parent middleware
   * first, then this one — with the shared contract ahead of it when
   * contract-first.
   */
  procedure<TContext>(
    app: RpcFactory<TContext>,
    ...middlewares: readonly AnyMiddlewareLike[]
  ): Procedure<TContext, {}, TValue, TDefinitions, "query">;
  procedure<TContext>(
    app: RpcFactory<TContext>,
    contract: ProcedureContract<TContext, {}, TValue, TDefinitions, "query">,
    ...middlewares: readonly AnyMiddlewareLike[]
  ): Procedure<TContext, {}, TValue, TDefinitions, "query">;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLayer = Layer<string, string, any, ErrorDefinitionMap>;

export type LayerValue<TLayer> = TLayer extends Layer<string, string, infer TValue, ErrorDefinitionMap>
  ? TValue
  : never;

export type LayerErrors<TLayer> = TLayer extends Layer<string, string, unknown, infer TDefinitions>
  ? TDefinitions
  : never;

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

  const layer: Layer<TName, TKey, TValue, TDefinitions> = {
    $layer: true,
    name: options.name,
    key: options.key,
    provides: options.provides as WireCodec<TValue, WireValue>,
    errors: options.errors,

    middleware: <TContext>(
      app: RpcFactory<TContext>,
      resolve: (args: {
        readonly context: TContext;
        readonly errors: TDefinitions;
      }) => MaybePromise<Result<TValue, ErrorUnion<TDefinitions>>>,
    ) =>
      app
        .middleware<{ readonly [K in TKey]: TValue }>()
        .errors(options.errors)
        .use(async ({ context, next }) => {
          const resolved = await resolve({
            context: context as TContext,
            errors: options.errors,
          });
          if (!resolved.ok) return resolved;
          return next({
            context: {
              ...(context as TContext & object),
              [options.key]: resolved.value,
            } as TContext & { readonly [K in TKey]: TValue },
          });
        }) as Middleware<
          TContext,
          TContext & { readonly [K in TKey]: TValue },
          TDefinitions
        >,

    contract: <TContext>(app: RpcFactory<TContext>) =>
      app
        .procedure()
        .input(wire.object({}))
        .output(options.provides)
        .errors(options.errors)
        .query() as ProcedureContract<TContext, {}, TValue, TDefinitions, "query">,

    procedure: <TContext>(
      app: RpcFactory<TContext>,
      ...chain: readonly (
        | ProcedureContract<TContext, {}, TValue, TDefinitions, "query">
        | AnyMiddlewareLike
      )[]
    ) => {
      const [contract, middlewares] = splitContract(chain) as [
        ProcedureContract<TContext, {}, TValue, TDefinitions, "query"> | undefined,
        readonly AnyMiddlewareLike[],
      ];
      return implementContextProcedure(
        app,
        contract ?? layer.contract(app),
        options.key,
        middlewares,
      );
    },

    require: (refineOptions) => {
      if (Object.keys(refineOptions.errors).length === 0) {
        throw new TypeError(
          `Layer ${refineOptions.name} refines ${options.name} but declares no errors; a refinement that cannot fail is the parent layer`,
        );
      }
      const refined = {
        $layer: true as const,
        name: refineOptions.name,
        key: options.key,
        provides: refineOptions.provides as unknown as WireCodec<never, WireValue>,
        errors: refineOptions.errors,

        middleware: <TContext>(app: RpcFactory<TContext>, after?: AnyMiddlewareLike) => {
          const base = app.middleware();
          const chained = after ? base.after(after) : base;
          return chained
            .errors(refineOptions.errors)
            .use(async ({ context, next }) => {
              const value = (context as { readonly [K in TKey]: TValue })[options.key];
              const resolved = await refineOptions.refine({
                value,
                errors: refineOptions.errors,
              });
              if (!resolved.ok) return resolved;
              return next({
                context: {
                  ...(context as TContext & object),
                  [options.key]: resolved.value,
                } as TContext & object,
              });
            });
        },

        contract: <TContext>(app: RpcFactory<TContext>) =>
          app
            .procedure()
            .input(wire.object({}))
            .output(refineOptions.provides)
            .errors(refineOptions.errors)
            .query(),

        procedure: <TContext>(
          app: RpcFactory<TContext>,
          ...chain: readonly (
            | ProcedureContract<TContext, {}, never, ErrorDefinitionMap, "query">
            | AnyMiddlewareLike
          )[]
        ) => {
          const [contract, middlewares] = splitContract(chain) as [
            ProcedureContract<TContext, {}, never, ErrorDefinitionMap, "query"> | undefined,
            readonly AnyMiddlewareLike[],
          ];
          return implementContextProcedure(
            app,
            contract
              ?? (refined.contract(app) as unknown as ProcedureContract<TContext, {}, never, ErrorDefinitionMap, "query">),
            options.key,
            middlewares,
          );
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Object.freeze(refined) as any;
    },
  };

  return Object.freeze(layer);
};

/** A leading contract in a `layer.procedure(...)` chain is optional; sniff it off. */
const splitContract = (
  chain: readonly unknown[],
): [unknown | undefined, readonly AnyMiddlewareLike[]] => {
  const [head, ...rest] = chain;
  return head !== null
    && typeof head === "object"
    && (head as { readonly _kind?: unknown })._kind === "procedure-contract"
    ? [head, rest as readonly AnyMiddlewareLike[]]
    : [undefined, chain as readonly AnyMiddlewareLike[]];
};

const implementContextProcedure = <
  TContext,
  TValue,
  TDefinitions extends ErrorDefinitionMap,
>(
  app: RpcFactory<TContext>,
  contract: ProcedureContract<TContext, {}, TValue, TDefinitions, "query">,
  key: string,
  middlewares: readonly AnyMiddlewareLike[],
): Procedure<TContext, {}, TValue, TDefinitions, "query"> => {
  if (middlewares.length === 0) {
    throw new TypeError("A layer's context procedure requires its middleware chain");
  }
  let implementer = app.implement(contract);
  for (const middleware of middlewares) {
    implementer = implementer.use(middleware) as typeof implementer;
  }
  return implementer.handler(({ context }) =>
    ok((context as Record<string, TValue>)[key] as TValue),
  ) as Procedure<TContext, {}, TValue, TDefinitions, "query">;
};

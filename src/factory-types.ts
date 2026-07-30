export interface RpcFactoryTypes<TRootContext> {
  readonly rootContext: TRootContext;
}

declare const rpcFactoryTypes: unique symbol;

/** Hidden associated record shared by contract-only and executable factories. */
export interface RpcFactoryTypeCarrier<TTypes extends RpcFactoryTypes<unknown>> {
  // Function input and output keep the root context invariant: a factory for a
  // specific request context must never widen to RpcFactory<unknown> during
  // inference and then ask later arguments to reconstruct what was lost.
  readonly [rpcFactoryTypes]?: (types: TTypes) => TTypes;
}

export type RpcFactoryTypesOf<TFactory> =
  TFactory extends RpcFactoryTypeCarrier<infer TTypes> ? TTypes : never;

export type RpcFactoryContext<TFactory> = RpcFactoryTypesOf<TFactory>["rootContext"];

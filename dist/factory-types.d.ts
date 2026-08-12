export interface RpcFactoryTypes<TRootContext> {
    readonly rootContext: TRootContext;
}
declare const rpcFactoryTypes: unique symbol;
/** Hidden associated record shared by contract-only and executable factories. */
export interface RpcFactoryTypeCarrier<TTypes extends RpcFactoryTypes<unknown>> {
    readonly [rpcFactoryTypes]?: (types: TTypes) => TTypes;
}
export type RpcFactoryTypesOf<TFactory> = TFactory extends RpcFactoryTypeCarrier<infer TTypes> ? TTypes : never;
export type RpcFactoryContext<TFactory> = RpcFactoryTypesOf<TFactory>["rootContext"];
export {};

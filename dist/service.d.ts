/**
 * Process-lifetime dependency injection for the root context.
 *
 * Services are a process-lifetime dependency graph with no recoverable error
 * channel. A construction failure is a startup defect; request-level tagged
 * failures belong to middleware and layers instead.
 */
import type { MaybePromise } from "./types.js";
/** Runtime-erased service shape. Its factory cannot be called without an explicit proof boundary. */
export interface AnyServiceDefinition {
    readonly $service: true;
    readonly name: string;
    readonly needs: ServiceDefinitionMap;
    readonly create: (needs: never) => MaybePromise<unknown>;
}
export type ServiceDefinitionMap = Readonly<Record<string, AnyServiceDefinition>>;
/** Every compile-time fact carried by one service definition. */
export interface ServiceTypes<TValue, TNeeds extends ServiceDefinitionMap = {}> {
    readonly value: TValue;
    readonly needs: TNeeds;
    /** Service construction throws on defects; it has no Result error channel. */
    readonly error: never;
}
export interface AnyServiceTypes {
    readonly value: unknown;
    readonly needs: ServiceDefinitionMap;
    readonly error: never;
}
declare const serviceTypes: unique symbol;
export interface ServiceDefinition<TTypes extends AnyServiceTypes> extends AnyServiceDefinition {
    readonly needs: TTypes["needs"];
    readonly create: (needs: ResolvedServices<TTypes["needs"]>) => MaybePromise<TTypes["value"]>;
    readonly [serviceTypes]?: TTypes;
}
export type ServiceTypesOf<TDefinition> = TDefinition extends ServiceDefinition<infer TTypes> ? TTypes : never;
export type ServiceValue<TDefinition> = ServiceTypesOf<TDefinition>["value"];
export type ResolvedServices<TDefinitions extends ServiceDefinitionMap> = {
    readonly [TKey in keyof TDefinitions]: ServiceValue<TDefinitions[TKey]>;
};
export type DefineServiceOptions<TValue, TNeeds extends ServiceDefinitionMap> = (keyof TNeeds extends never ? {
    /** A dependency-free service cannot promise dependencies to `create`. */
    readonly needs?: never;
} : {
    /** Services this one depends on, by the property name `create` receives. */
    readonly needs: TNeeds;
}) & {
    readonly create: (needs: ResolvedServices<TNeeds>) => MaybePromise<TValue>;
};
/**
 * Declares a service. Store the result in a module constant: memoization and
 * cycle identity are by definition reference, not by name or structural type.
 */
export declare function defineService<TValue>(name: string, options: DefineServiceOptions<TValue, {}>): ServiceDefinition<ServiceTypes<TValue, {}>>;
export declare function defineService<TValue, const TNeeds extends ServiceDefinitionMap>(name: string, options: DefineServiceOptions<TValue, TNeeds> & {
    readonly needs: TNeeds;
}): ServiceDefinition<ServiceTypes<TValue, TNeeds>>;
/**
 * Resolves a service graph once, dependencies first. Shared dependencies are
 * constructed once per resolution and cycles report the offending path.
 */
export declare const resolveServices: <const TDefinitions extends ServiceDefinitionMap>(definitions: TDefinitions) => Promise<ResolvedServices<TDefinitions>>;
export {};

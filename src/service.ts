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

export type ServiceTypesOf<TDefinition> =
  TDefinition extends ServiceDefinition<infer TTypes> ? TTypes : never;

export type ServiceValue<TDefinition> = ServiceTypesOf<TDefinition>["value"];

export type ResolvedServices<TDefinitions extends ServiceDefinitionMap> = {
  readonly [TKey in keyof TDefinitions]: ServiceValue<TDefinitions[TKey]>;
};

export type DefineServiceOptions<
  TValue,
  TNeeds extends ServiceDefinitionMap,
> = (keyof TNeeds extends never
  ? {
      /** A dependency-free service cannot promise dependencies to `create`. */
      readonly needs?: never;
    }
  : {
      /** Services this one depends on, by the property name `create` receives. */
      readonly needs: TNeeds;
    }) & {
  readonly create: (needs: ResolvedServices<TNeeds>) => MaybePromise<TValue>;
};

/**
 * Declares a service. Store the result in a module constant: memoization and
 * cycle identity are by definition reference, not by name or structural type.
 */
export function defineService<TValue>(
  name: string,
  options: DefineServiceOptions<TValue, {}>,
): ServiceDefinition<ServiceTypes<TValue, {}>>;
export function defineService<TValue, const TNeeds extends ServiceDefinitionMap>(
  name: string,
  options: DefineServiceOptions<TValue, TNeeds> & { readonly needs: TNeeds },
): ServiceDefinition<ServiceTypes<TValue, TNeeds>>;
export function defineService(
  name: string,
  options: {
    readonly needs?: ServiceDefinitionMap;
    readonly create: (needs: never) => MaybePromise<unknown>;
  },
): AnyServiceDefinition {
  return Object.freeze({
    $service: true,
    name,
    needs: options.needs ?? Object.freeze({}),
    create: options.create,
  });
}

/**
 * Resolves a service graph once, dependencies first. Shared dependencies are
 * constructed once per resolution and cycles report the offending path.
 */
export const resolveServices = async <const TDefinitions extends ServiceDefinitionMap>(
  definitions: TDefinitions,
): Promise<ResolvedServices<TDefinitions>> => {
  const memo = new Map<AnyServiceDefinition, Promise<unknown>>();

  const visited = new Set<AnyServiceDefinition>();
  const visiting = new Set<AnyServiceDefinition>();
  const validate = (definition: AnyServiceDefinition, path: readonly string[]): void => {
    if (visiting.has(definition)) {
      throw new TypeError(`Service dependency cycle: ${[...path, definition.name].join(" -> ")}`);
    }
    if (visited.has(definition)) return;
    visiting.add(definition);
    for (const dependency of Object.values(definition.needs)) {
      validate(dependency, [...path, definition.name]);
    }
    visiting.delete(definition);
    visited.add(definition);
  };
  for (const definition of Object.values(definitions)) validate(definition, []);

  const resolve = (definition: AnyServiceDefinition): Promise<unknown> => {
    const cached = memo.get(definition);
    if (cached) return cached;
    const pending = (async () => {
      const needs: Record<string, unknown> = {};
      for (const [key, dependency] of Object.entries(definition.needs)) {
        needs[key] = await resolve(dependency);
      }
      // Audited existential boundary: the graph walk resolved exactly the
      // dependency record declared on this definition before invoking create.
      return definition.create(needs as never);
    })();
    memo.set(definition, pending);
    return pending;
  };

  const resolved: Record<string, unknown> = {};
  for (const [key, definition] of Object.entries(definitions)) {
    resolved[key] = await resolve(definition);
  }
  // Dynamic record assembly follows the exact input keys one-for-one.
  return resolved as ResolvedServices<TDefinitions>;
};

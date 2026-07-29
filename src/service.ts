/**
 * Process-lifetime dependency injection for the root context.
 *
 * Two kinds of context feed a procedure, and they compose differently:
 *
 * - **Services** — database pools, worker bindings, API clients. Process
 *   lifetime, a dependency *graph*, and no wire errors: if a service cannot be
 *   built the process is broken, not the request. This module owns them.
 * - **Request layers** — session, viewer, organization. Request lifetime, an
 *   ordered *chain*, and every step can fail with a tagged error that joins the
 *   operation union. Middleware (and the layer factory) owns those.
 *
 * A service declares what it needs; `resolveServices` builds the graph once at
 * process start, memoized by definition reference identity — a service shared
 * by several dependents (the diamond) is constructed exactly once. The resolved
 * record becomes the root context that `createContext` closes over, so request
 * middleware like auth reads `context.db` without caring how it was built.
 */

type MaybePromise<T> = T | Promise<T>;

export interface ServiceDefinition<TValue, TNeeds extends ServiceDefinitionMap = {}> {
  readonly $service: true;
  readonly name: string;
  readonly needs: TNeeds;
  readonly create: (needs: ResolvedServices<TNeeds>) => MaybePromise<TValue>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyServiceDefinition = ServiceDefinition<any, any>;

export type ServiceDefinitionMap = Readonly<Record<string, AnyServiceDefinition>>;

export type ServiceValue<TDefinition> =
  TDefinition extends ServiceDefinition<
    infer TValue,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >
    ? TValue
    : never;

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
 * Declares a service: a name, its dependencies, and how to build it. Store the
 * result in a module-level constant — memoization is by reference identity, so
 * two calls to `defineService` are two services even with identical options.
 */
export const defineService = <TValue, const TNeeds extends ServiceDefinitionMap = {}>(
  name: string,
  options: DefineServiceOptions<TValue, TNeeds>,
): ServiceDefinition<TValue, TNeeds> => {
  const needs = (options.needs ?? {}) as TNeeds;
  return Object.freeze({
    $service: true,
    name,
    needs,
    create: options.create,
  });
};

/**
 * Resolves a service graph. Each definition is constructed at most once per
 * call, dependencies first; a shared dependency is one instance no matter how
 * many services need it. Cycles are rejected with the offending path.
 *
 * Call this once at process start and close over the result in
 * `createContext` — resolving per request would defeat the memoization.
 */
export const resolveServices = async <const TDefinitions extends ServiceDefinitionMap>(
  definitions: TDefinitions,
): Promise<ResolvedServices<TDefinitions>> => {
  const memo = new Map<AnyServiceDefinition, Promise<unknown>>();

  // Validate the definition graph synchronously before async construction.
  // A single mutable "currently building" set cannot detect a back-edge that
  // reaches a memoized sibling while its promise is still pending.
  const visited = new Set<AnyServiceDefinition>();
  const visiting = new Set<AnyServiceDefinition>();
  const validate = (definition: AnyServiceDefinition, path: readonly string[]): void => {
    if (visiting.has(definition)) {
      throw new TypeError(`Service dependency cycle: ${[...path, definition.name].join(" -> ")}`);
    }
    if (visited.has(definition)) return;
    visiting.add(definition);
    for (const dependency of Object.values(definition.needs as ServiceDefinitionMap)) {
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
      for (const [key, dependency] of Object.entries(definition.needs as ServiceDefinitionMap)) {
        needs[key] = await resolve(dependency);
      }
      return definition.create(needs as ResolvedServices<ServiceDefinitionMap>);
    })();
    memo.set(definition, pending);
    return pending;
  };

  const resolved: Record<string, unknown> = {};
  for (const [key, definition] of Object.entries(definitions)) {
    resolved[key] = await resolve(definition);
  }
  return resolved as ResolvedServices<TDefinitions>;
};

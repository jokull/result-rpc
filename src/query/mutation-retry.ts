import { getOnlineSnapshot } from "../connectivity.js";
import type { AnyErrorDefinition, AnyTaggedError } from "../error.js";
import type { ErrorDefinitionMap } from "../error-map.js";
import { frameworkErrorDefinitions } from "../framework-errors.js";

type MutationRetryConfiguration<TError extends AnyTaggedError> =
  | false
  | number
  | ((error: TError, failureCount: number) => boolean)
  | undefined;

export const definitionFor = (
  definitions: ErrorDefinitionMap,
  failure: AnyTaggedError,
): AnyErrorDefinition | undefined =>
  [...Object.values(definitions), ...Object.values(frameworkErrorDefinitions)].find(
    (definition) => definition.tag === failure._tag,
  );

/**
 * The canonical mutation retry decision after the caller has established that
 * `failure` belongs to the procedure's exact error registry. React shell
 * ownership composes in front of this function; residual failures retain the
 * same callback, numeric, disabled, and error-policy semantics as QueryRuntime.
 */
export const shouldRetryMutation = <TError extends AnyTaggedError>(
  definitions: ErrorDefinitionMap,
  configured: MutationRetryConfiguration<TError>,
  failureCount: number,
  failure: TError,
): boolean => {
  if (configured === undefined) {
    if (failureCount >= 3) return false;
    if (failure._tag === "client/offline") return getOnlineSnapshot();
    return definitionFor(definitions, failure)?.policy.retry === "after";
  }
  if (typeof configured === "function") return configured(failure, failureCount);
  return configured !== false && failureCount < configured;
};

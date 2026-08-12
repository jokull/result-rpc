import type { AnyErrorDefinition, AnyTaggedError } from "../error.js";
import type { ErrorDefinitionMap } from "../error-map.js";
type MutationRetryConfiguration<TError extends AnyTaggedError> = false | number | ((error: TError, failureCount: number) => boolean) | undefined;
export declare const definitionFor: (definitions: ErrorDefinitionMap, failure: AnyTaggedError) => AnyErrorDefinition | undefined;
/**
 * The canonical mutation retry decision after the caller has established that
 * `failure` belongs to the procedure's exact error registry. React shell
 * ownership composes in front of this function; residual failures retain the
 * same callback, numeric, disabled, and error-policy semantics as QueryRuntime.
 */
export declare const shouldRetryMutation: <TError extends AnyTaggedError>(definitions: ErrorDefinitionMap, configured: MutationRetryConfiguration<TError>, failureCount: number, failure: TError) => boolean;
export {};

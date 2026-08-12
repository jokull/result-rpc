import { frameworkErrorDefinitions } from "../framework-errors.js";
import { getOnlineSnapshot } from "../connectivity.js";
//#region src/query/mutation-retry.ts
const definitionFor = (definitions, failure) => [...Object.values(definitions), ...Object.values(frameworkErrorDefinitions)].find((definition) => definition.tag === failure._tag);
/**
* The canonical mutation retry decision after the caller has established that
* `failure` belongs to the procedure's exact error registry. React shell
* ownership composes in front of this function; residual failures retain the
* same callback, numeric, disabled, and error-policy semantics as QueryRuntime.
*/
const shouldRetryMutation = (definitions, configured, failureCount, failure) => {
	if (configured === void 0) {
		if (failureCount >= 3) return false;
		if (failure._tag === "client/offline") return getOnlineSnapshot();
		return definitionFor(definitions, failure)?.policy.retry === "after";
	}
	if (typeof configured === "function") return configured(failure, failureCount);
	return configured !== false && failureCount < configured;
};
//#endregion
export { definitionFor, shouldRetryMutation };

//# sourceMappingURL=mutation-retry.js.map
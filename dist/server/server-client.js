import { ServerBadRequest, ServerInternal } from "../framework-errors.js";
import { effectiveContractVersion } from "../contract-digest.js";
import { executeProcedure, executeSubscription } from "./contract.js";
import { createClientErrorRegistry, normalizeClientCallInput } from "../client/base-client.js";
import { registerClientLike } from "../client/client-metadata.js";
//#region src/server/server-client.ts
const isProcedure = (value) => "_kind" in value && (value._kind === "procedure" || value._kind === "subscription-procedure");
/**
* Builds a direct, in-process server client. Middleware, input/output codecs,
* entity branding, and private-error sanitization still run; transport,
* envelopes, retries, batching, and browser boundary errors do not.
*
* Mutations execute normally, but cache declarations are inert because there
* is no browser cache to patch or invalidate.
*/
const createServerClient = (router, options) => {
	const boundaryDefinitions = [ServerBadRequest, ServerInternal];
	const registry = /* @__PURE__ */ new Map();
	const executionOptions = (path, call) => ({
		context: options.context,
		procedurePath: path,
		...options.responseHeaders === void 0 ? {} : { responseHeaders: options.responseHeaders },
		...call?.signal === void 0 ? {} : { signal: call.signal },
		...options.onInternalError === void 0 ? {} : { onInternalError: options.onInternalError }
	});
	const callable = (procedure, path) => {
		const fn = (...args) => {
			const input = normalizeClientCallInput(args);
			return procedure._kind === "subscription-procedure" ? executeSubscription(procedure, input, executionOptions(path, args[1])) : executeProcedure(procedure, input, executionOptions(path, args[1]));
		};
		Object.defineProperty(fn, "$kind", {
			value: procedure._def.kind,
			enumerable: true
		});
		registry.set(path, {
			fn,
			procedure
		});
		return fn;
	};
	const build = (node, prefix) => {
		const out = {};
		for (const [key, value] of Object.entries(node)) {
			const path = [...prefix, key];
			out[key] = isProcedure(value) ? callable(value, path.join(".")) : build(value, path);
		}
		return out;
	};
	const client = build(router.record, []);
	Object.defineProperty(client, "$errors", {
		value: createClientErrorRegistry(router, boundaryDefinitions),
		enumerable: true
	});
	registerClientLike(client, router, registry, boundaryDefinitions, effectiveContractVersion(router, options.contractVersion));
	return client;
};
//#endregion
export { createServerClient };

//# sourceMappingURL=server-client.js.map
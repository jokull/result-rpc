import { effectiveContractVersion } from "../contract-digest.js";
import { createProcedureClientErrorRegistry } from "./base-client.js";
//#region src/client/client-metadata.ts
const procedureClientMetadata = /* @__PURE__ */ new WeakMap();
const clientIdentities = /* @__PURE__ */ new WeakMap();
const clientRuntimeMetadata = /* @__PURE__ */ new WeakMap();
const touchedByResult = /* @__PURE__ */ new WeakMap();
const registerClientIdentity = (value, clientIdentity, router, contractVersion) => {
	clientIdentities.set(value, clientIdentity);
	if (router) clientRuntimeMetadata.set(clientIdentity, {
		router,
		contractVersion: contractVersion ?? effectiveContractVersion(router)
	});
};
const registerProcedureClient = (fn, metadata) => {
	clientIdentities.set(fn, metadata.clientIdentity);
	procedureClientMetadata.set(fn, metadata);
};
/** Registers a non-browser caller so the query runtime can prefetch through it. */
const registerClientLike = (caller, router, procedures, boundaryDefinitions, contractVersion) => {
	const clientIdentity = Object.freeze({});
	registerClientIdentity(caller, clientIdentity, router, contractVersion);
	for (const [path, entry] of procedures) registerProcedureClient(entry.fn, {
		path,
		procedure: entry.procedure,
		errors: createProcedureClientErrorRegistry(entry.procedure, boundaryDefinitions),
		clientIdentity
	});
};
const getClientRouter = (clientIdentity) => clientRuntimeMetadata.get(clientIdentity)?.router;
const getClientContractVersion = (clientIdentity) => clientRuntimeMetadata.get(clientIdentity)?.contractVersion;
function getProcedureClientMetadata(value) {
	return procedureClientMetadata.get(value);
}
const getClientIdentity = (value) => typeof value === "object" && value !== null || typeof value === "function" ? clientIdentities.get(value) : void 0;
/** Records the `model:id` keys the server declared touching for one result. */
const recordTouchedEntities = (result, keys) => {
	touchedByResult.set(result, keys);
};
const getTouchedEntities = (result) => touchedByResult.get(result);
//#endregion
export { getClientContractVersion, getClientIdentity, getClientRouter, getProcedureClientMetadata, getTouchedEntities, recordTouchedEntities, registerClientIdentity, registerClientLike, registerProcedureClient };

//# sourceMappingURL=client-metadata.js.map
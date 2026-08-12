import { wire } from "./wire.js";
import { frameworkError } from "./error.js";
//#region src/framework-errors.ts
const ServerBadRequest = frameworkError({
	tag: "server/bad-request",
	data: wire.object({ issues: wire.array(wire.object({
		path: wire.array(wire.string),
		message: wire.string
	})) }),
	httpStatus: 400,
	retry: "never",
	visibility: "public",
	severity: "warning"
});
const ServerInternal = frameworkError({
	tag: "server/internal",
	data: wire.object({ incidentId: wire.string }),
	httpStatus: 500,
	retry: "never",
	visibility: "public",
	severity: "error"
});
const ClientOffline = frameworkError({
	tag: "client/offline",
	data: wire.object({}),
	httpStatus: 503,
	retry: "transient",
	visibility: "public",
	severity: "info"
});
const ClientNetworkFailure = frameworkError({
	tag: "client/network-failure",
	data: wire.object({ retryable: wire.boolean }),
	httpStatus: 503,
	retry: "transient",
	visibility: "public",
	severity: "warning"
});
const ClientTimeout = frameworkError({
	tag: "client/timeout",
	data: wire.object({ timeoutMs: wire.integer({ min: 0 }) }),
	httpStatus: 504,
	retry: "transient",
	visibility: "public",
	severity: "warning"
});
const ClientHttpFailure = frameworkError({
	tag: "client/http-failure",
	data: wire.object({ status: wire.integer({
		min: 100,
		max: 599
	}) }),
	httpStatus: 502,
	retry: "transient",
	visibility: "public",
	severity: "warning"
});
const ClientProtocolViolation = frameworkError({
	tag: "client/protocol-violation",
	data: wire.object({ reason: wire.enum([
		"content-type",
		"version",
		"envelope",
		"unknown-tag"
	]) }),
	httpStatus: 502,
	retry: "never",
	visibility: "public",
	severity: "error"
});
const ClientDecodeFailure = frameworkError({
	tag: "client/decode-failure",
	data: wire.object({ target: wire.enum(["success", "error"]) }),
	httpStatus: 502,
	retry: "never",
	visibility: "public",
	severity: "error"
});
/**
* A contract failure reclassified because the server's contract digest did not
* match this client's: the client is a stale deploy, not a buggy one. The fix
* is a reload, so the built-in stale shell defaults to exactly that. Carries
* only the original tag — never values.
*/
const ClientStale = frameworkError({
	tag: "client/stale",
	data: wire.object({ reclassifiedFrom: wire.string }),
	httpStatus: 426,
	retry: "never",
	visibility: "public",
	severity: "info"
});
/** The tags a contract-digest mismatch may reclassify into `client/stale`. */
const STALE_RECLASSIFIABLE_TAGS = /* @__PURE__ */ new Set([
	"server/bad-request",
	"client/decode-failure",
	"client/protocol-violation",
	"client/http-failure"
]);
/**
* Transport failures: real, recoverable, and not about any single operation.
* Every member declares `retry: "transient"`. Shell layers usually claim these
* with `effect: "pause"` so the app shell owns the banner.
*/
const transportErrors = {
	ClientOffline,
	ClientNetworkFailure,
	ClientTimeout
};
/**
* Defects: nothing a component can render a branch for. Shell layers usually
* claim these with `effect: "escalate"` so the nearest error boundary owns them.
*/
const defectErrors = {
	ClientHttpFailure,
	ClientProtocolViolation,
	ClientDecodeFailure,
	ServerBadRequest,
	ServerInternal
};
/** A deploy left this client behind; the built-in stale shell reloads by default. */
const staleErrors = { ClientStale };
const frameworkErrorDefinitions = {
	ServerBadRequest,
	ServerInternal,
	ClientOffline,
	ClientNetworkFailure,
	ClientTimeout,
	ClientHttpFailure,
	ClientProtocolViolation,
	ClientDecodeFailure,
	ClientStale
};
/** Maps codec issues into `server/bad-request` data: paths and messages only, never values. */
const badRequestFromIssues = (cause) => {
	const issues = Array.isArray(cause) ? cause.slice(0, 20).map((issue) => {
		const path = issue !== null && typeof issue === "object" && "path" in issue && Array.isArray(issue.path) ? issue.path : [];
		const message = issue !== null && typeof issue === "object" && "message" in issue ? issue.message : void 0;
		return {
			path: path.map(String),
			message: typeof message === "string" ? message : "Invalid value"
		};
	}) : [{
		path: [],
		message: "Invalid input"
	}];
	return ServerBadRequest({ issues });
};
//#endregion
export { ClientDecodeFailure, ClientHttpFailure, ClientNetworkFailure, ClientOffline, ClientProtocolViolation, ClientStale, ClientTimeout, STALE_RECLASSIFIABLE_TAGS, ServerBadRequest, ServerInternal, badRequestFromIssues, defectErrors, frameworkErrorDefinitions, staleErrors, transportErrors };

//# sourceMappingURL=framework-errors.js.map
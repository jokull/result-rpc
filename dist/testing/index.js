import { ClientDecodeFailure, ClientHttpFailure, ClientNetworkFailure, ClientOffline, ClientProtocolViolation, ClientStale, ClientTimeout, ServerBadRequest, ServerInternal } from "../framework-errors.js";
import { PROTOCOL_VERSION } from "../protocol.js";
import { createFetchHandler } from "../server/http.js";
import { fetchTransport } from "../client/transport.js";
import { createClientRuntime } from "../client/client.js";
//#region src/testing/index.ts
function createFixtureClient(options) {
	return createClientRuntime("contract" in options ? options.contract : options.router, options);
}
/**
* A wire-faithful in-process client for tests. Calls still cross the real
* serializer, protocol envelope, fetch handler, and browser client decoder.
*/
const createParityClient = (router, options) => {
	const handler = createFetchHandler({
		router,
		createContext: () => options.context,
		...options.onInternalError === void 0 ? {} : { onInternalError: options.onInternalError },
		...options.contractVersion === void 0 ? {} : { contractVersion: options.contractVersion }
	});
	const localFetch = Object.assign(async (input, init) => handler(new Request(input, init)), { preconnect: globalThis.fetch.preconnect });
	return createFixtureClient({
		router,
		...options.contractVersion === void 0 ? {} : { contractVersion: options.contractVersion },
		transport: fetchTransport({
			url: "http://result-rpc.local/rpc",
			fetch: localFetch
		})
	});
};
//#endregion
export { ClientDecodeFailure, ClientHttpFailure, ClientNetworkFailure, ClientOffline, ClientProtocolViolation, ClientStale, ClientTimeout, PROTOCOL_VERSION, ServerBadRequest, ServerInternal, createFixtureClient, createParityClient };

//# sourceMappingURL=index.js.map
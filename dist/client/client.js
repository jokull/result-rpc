import { err, ok } from "../result.js";
import { encodeProcedureInput } from "../wire.js";
import { DEFAULT_MAX_WIRE_BYTES, deserialize } from "../serializer.js";
import { ClientDecodeFailure, ClientHttpFailure, ClientNetworkFailure, ClientOffline, ClientProtocolViolation, ClientStale, ClientTimeout, STALE_RECLASSIFIABLE_TAGS, ServerBadRequest, ServerInternal, frameworkErrorDefinitions } from "../framework-errors.js";
import { effectiveContractVersion } from "../contract-digest.js";
import { entityCacheKeyFromWire } from "../model.js";
import { decodeResponseEnvelope, decodeStreamFrame, isProtocolContentType, isStreamContentType } from "../protocol.js";
import { createClientErrorRegistry, createProcedureClientErrorRegistry, normalizeClientCallInput } from "./base-client.js";
import { getClientIdentity, getProcedureClientMetadata, recordTouchedEntities, registerClientIdentity, registerProcedureClient } from "./client-metadata.js";
import { getOnlineSnapshot } from "../connectivity.js";
import { cancelled, isCancelled, requestEnvelope } from "./transport.js";
//#region src/client/client.ts
const clientEventListeners = /* @__PURE__ */ new WeakMap();
/** Internal: the event listener registered for a client, by client identity. */
const getClientEventListener = (clientIdentity) => clientEventListeners.get(clientIdentity);
const clientFailure = (outcome) => {
	switch (outcome.reason) {
		case "offline": return ClientOffline({});
		case "network": return ClientNetworkFailure({ retryable: false });
		case "timeout": return ClientTimeout({ timeoutMs: outcome.timeoutMs });
	}
};
const decodeEnvelope = (procedure, envelope, status) => {
	try {
		if (envelope.status === "ok") {
			if (status < 200 || status >= 300) return err(ClientProtocolViolation({ reason: "envelope" }));
			const decoded = procedure._def.output.decode(envelope.value);
			return decoded.ok ? ok(decoded.value) : err(ClientDecodeFailure({ target: "success" }));
		}
		for (const framework of [ServerInternal, ServerBadRequest]) {
			if (framework.tag !== envelope.error._tag) continue;
			if (status !== framework.policy.httpStatus && status !== 200) return err(ClientProtocolViolation({ reason: "envelope" }));
			const decoded = framework.decode(envelope.error);
			return decoded.ok ? err(decoded.value) : err(ClientDecodeFailure({ target: "error" }));
		}
		const definitions = procedure._def.definitions;
		const definition = Object.values(definitions).find((candidate) => candidate.tag === envelope.error._tag);
		if (!definition || definition.policy.visibility !== "public") return err(ClientProtocolViolation({ reason: "unknown-tag" }));
		const decoded = definition.decode(envelope.error);
		if (!decoded.ok) return err(ClientDecodeFailure({ target: "error" }));
		if (status !== definition.policy.httpStatus && status !== 200) return err(ClientProtocolViolation({ reason: "envelope" }));
		return err(decoded.value);
	} catch {
		return err(ClientDecodeFailure({ target: envelope.status === "ok" ? "success" : "error" }));
	}
};
const createSkewMonitor = (contract, onEvent) => {
	let reported = false;
	const mismatch = (serverContract) => {
		if (serverContract === contract) return false;
		if (!reported) {
			reported = true;
			onEvent?.({
				type: "skew",
				clientContract: contract,
				serverContract
			});
		}
		return true;
	};
	return {
		reconcile: (result, serverContract) => {
			if (typeof serverContract !== "string" || serverContract.trim().length === 0) return err(ClientProtocolViolation({ reason: "version" }));
			if (!mismatch(serverContract)) return result;
			if (!result.isOk() && STALE_RECLASSIFIABLE_TAGS.has(result.error._tag)) return err(ClientStale({ reclassifiedFrom: result.error._tag }));
			return result;
		},
		reconcileStream: (serverContract) => {
			if (typeof serverContract !== "string" || serverContract.trim().length === 0) return err(ClientProtocolViolation({ reason: "version" }));
			if (!mismatch(serverContract)) return ok(void 0);
			return err(ClientStale({ reclassifiedFrom: "client/protocol-violation" }));
		}
	};
};
const callProcedureOnce = async (procedure, path, input, transport, skew, options) => {
	const encodedInput = encodeProcedureInput(procedure._def.input, input);
	if (!encodedInput.ok) {
		const details = encodedInput.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
		throw new TypeError(`Invalid input for ${path}: ${details}`);
	}
	const outcome = await transport.request(requestEnvelope(path, encodedInput.value), options);
	if (!outcome.ok) return err(clientFailure(outcome));
	const { response } = outcome;
	return skew.reconcile(decodeTransportResponse(procedure, response), response.contract);
};
const decodeTransportResponse = (procedure, response) => {
	if (!isProtocolContentType(response.contentType)) return err(response.status >= 400 ? ClientHttpFailure({ status: response.status }) : ClientProtocolViolation({ reason: "content-type" }));
	const decodedBody = deserialize(response.body, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
	if (!decodedBody.ok) return err(response.status >= 400 ? ClientHttpFailure({ status: response.status }) : ClientProtocolViolation({ reason: "envelope" }));
	const raw = decodedBody.value;
	const envelope = decodeResponseEnvelope(raw);
	if (!envelope) return err(ClientProtocolViolation({ reason: raw !== null && typeof raw === "object" && "v" in raw && raw.v !== 1 ? "version" : "envelope" }));
	const result = decodeEnvelope(procedure, envelope, response.status);
	if (envelope.touched !== void 0) {
		const keys = envelope.touched.flatMap((key) => {
			if (typeof key !== "string") return [];
			const parsed = entityCacheKeyFromWire(key);
			return parsed === void 0 ? [] : [parsed];
		});
		if (keys.length > 0) recordTouchedEntities(result, keys);
	}
	return result;
};
const retryDelayFor = (procedure, kind, failure, attempt) => {
	const definitions = {
		...procedure._def.definitions,
		ServerInternal,
		ClientOffline,
		ClientNetworkFailure,
		ClientTimeout,
		ClientHttpFailure,
		ClientProtocolViolation,
		ClientDecodeFailure,
		ClientStale
	};
	const definition = Object.values(definitions).find((candidate) => candidate.tag === failure._tag);
	if (failure._tag === "client/offline" && !getOnlineSnapshot()) return void 0;
	if (!definition || definition.policy.retry === "never" || attempt >= 3) return void 0;
	if (kind === "mutation" && failure._tag !== "client/offline" && definition.policy.retry !== "after") return void 0;
	if (definition.policy.retry === "after") return failure.data !== null && typeof failure.data === "object" && "retryAfterMs" in failure.data && typeof failure.data.retryAfterMs === "number" ? failure.data.retryAfterMs : void 0;
	return Math.min(250 * 2 ** attempt, 2e3);
};
const waitForRetry = (delay, signal) => new Promise((resolve, reject) => {
	if (signal?.aborted) return reject(cancelled);
	const onAbort = () => {
		clearTimeout(timeout);
		reject(cancelled);
	};
	const timeout = setTimeout(() => {
		signal?.removeEventListener("abort", onAbort);
		resolve();
	}, Math.max(0, delay));
	signal?.addEventListener("abort", onAbort, { once: true });
});
const callProcedure = async (procedure, path, input, transport, onEvent, skew, options) => {
	const kind = procedure._def.kind;
	if (kind === "subscription") throw new TypeError("Subscription procedures use the streaming client path");
	const startedAt = Date.now();
	onEvent?.({
		type: "call",
		kind,
		path
	});
	for (let attempt = 0;; attempt += 1) {
		const result = await callProcedureOnce(procedure, path, input, transport, skew, options);
		if (result.status === "ok") {
			onEvent?.({
				type: "success",
				kind,
				path,
				durationMs: Date.now() - startedAt
			});
			return result;
		}
		const delay = options?.retry === "from-error-policy" ? retryDelayFor(procedure, kind, result.error, attempt) : void 0;
		if (delay === void 0) {
			onEvent?.({
				type: "failure",
				kind,
				path,
				tag: result.error._tag,
				durationMs: Date.now() - startedAt
			});
			return result;
		}
		onEvent?.({
			type: "retry",
			path,
			tag: result.error._tag,
			attempt: attempt + 1,
			delayMs: delay
		});
		await waitForRetry(delay, options?.signal);
	}
};
const subscribeProcedure = (procedure, path, input, transport, onEvent, skew, options = {}) => {
	const controller = new AbortController();
	const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
	async function* stream() {
		const encodedInput = encodeProcedureInput(procedure._def.input, input);
		if (!encodedInput.ok) throw new TypeError(`Invalid input for ${path}`);
		if (!transport.stream) {
			yield err(ClientProtocolViolation({ reason: "content-type" }));
			return;
		}
		const outcome = await transport.stream(requestEnvelope(path, encodedInput.value, options.lastEventId), {
			...options,
			signal
		});
		if (!outcome.ok) {
			yield err(clientFailure(outcome));
			return;
		}
		const { response } = outcome;
		const cancelBody = async () => {
			if (!response.body) return;
			try {
				await response.body.cancel();
			} catch {}
		};
		const handshake = skew.reconcileStream(response.contract);
		if (!handshake.isOk()) {
			await cancelBody();
			yield handshake;
			return;
		}
		if (response.status < 200 || response.status >= 300 || !isStreamContentType(response.contentType) || !response.body) {
			await cancelBody();
			yield err(response.status >= 400 ? ClientHttpFailure({ status: response.status }) : ClientProtocolViolation({ reason: "content-type" }));
			return;
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let expectedSequence = 0;
		let sourceClosed = false;
		let readerCancellation;
		const cancelReader = () => {
			readerCancellation ??= reader.cancel().catch(() => void 0);
			return readerCancellation;
		};
		const abortReader = () => void cancelReader();
		if (signal.aborted) abortReader();
		else signal.addEventListener("abort", abortReader, { once: true });
		try {
			while (true) {
				const chunk = await reader.read();
				if (signal.aborted) throw cancelled;
				if (chunk.done) sourceClosed = true;
				buffer += decoder.decode(chunk.value, { stream: !chunk.done });
				if (new TextEncoder().encode(buffer).byteLength > 1048576) {
					yield err(ClientProtocolViolation({ reason: "envelope" }));
					return;
				}
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (line.length === 0) continue;
					const decoded = deserialize(line, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
					const frame = decoded.ok ? decodeStreamFrame(decoded.value) : void 0;
					if (!frame || frame.seq !== expectedSequence++) {
						yield err(ClientProtocolViolation({ reason: "envelope" }));
						return;
					}
					if (frame.done) return;
					const result = decodeEnvelope(procedure, frame.response, 200);
					yield result;
					if (!result.isOk()) return;
				}
				if (chunk.done) {
					yield err(ClientProtocolViolation({ reason: "envelope" }));
					return;
				}
			}
		} catch (failure) {
			if (isCancelled(failure)) throw failure;
			yield err(ClientNetworkFailure({ retryable: false }));
		} finally {
			signal.removeEventListener("abort", abortReader);
			if (!sourceClosed) await cancelReader();
			reader.releaseLock();
		}
	}
	return {
		close: () => controller.abort(),
		async *[Symbol.asyncIterator]() {
			const startedAt = Date.now();
			onEvent?.({
				type: "call",
				kind: "subscription",
				path
			});
			let last;
			let failureObserved = false;
			for await (const result of stream()) {
				last = result;
				if (!result.isOk()) {
					failureObserved = true;
					onEvent?.({
						type: "failure",
						kind: "subscription",
						path,
						tag: result.error._tag,
						durationMs: Date.now() - startedAt
					});
				}
				yield result;
			}
			if (last === void 0 || last.status === "ok") onEvent?.({
				type: "success",
				kind: "subscription",
				path,
				durationMs: Date.now() - startedAt
			});
			else if (!failureObserved) onEvent?.({
				type: "failure",
				kind: "subscription",
				path,
				tag: last.error._tag,
				durationMs: Date.now() - startedAt
			});
		}
	};
};
const createProxy = (router, transport, onEvent, skew, path, cache, clientIdentity, errorRegistry, boundaryDefinitions) => {
	const procedurePath = path.join(".");
	const cached = cache.get(procedurePath);
	if (cached) return cached;
	const procedure = router.procedures.get(procedurePath);
	const proxy = new Proxy(() => void 0, {
		get: (_target, property) => {
			if (property === "$kind" && procedure) return procedure._def.kind;
			if (property === "$errors" && path.length === 0) return errorRegistry;
			if (typeof property !== "string") return void 0;
			const candidate = [...path, property];
			const candidatePath = candidate.join(".");
			if (!(router.procedures.has(candidatePath) || [...router.procedures.keys()].some((key) => key.startsWith(`${candidatePath}.`)))) return void 0;
			return createProxy(router, transport, onEvent, skew, candidate, cache, clientIdentity, errorRegistry, boundaryDefinitions);
		},
		apply: (_target, _thisArg, argumentsList) => {
			if (!procedure) throw new TypeError(`Unknown procedure ${procedurePath}`);
			const input = normalizeClientCallInput(argumentsList);
			if (procedure._def.kind === "subscription") return subscribeProcedure(procedure, procedurePath, input, transport, onEvent, skew, argumentsList[1]);
			return callProcedure(procedure, procedurePath, input, transport, onEvent, skew, argumentsList[1]);
		}
	});
	registerClientIdentity(proxy, clientIdentity);
	if (procedure) registerProcedureClient(proxy, {
		path: procedurePath,
		procedure,
		errors: createProcedureClientErrorRegistry(procedure, boundaryDefinitions),
		clientIdentity
	});
	cache.set(procedurePath, proxy);
	return proxy;
};
/** @internal Shared with `result-rpc/testing`; not exported from `result-rpc/client`. */
const createClientRuntime = (router, options) => {
	const clientIdentity = Object.freeze({});
	const contractVersion = effectiveContractVersion(router, options.contractVersion);
	registerClientIdentity(clientIdentity, clientIdentity, router, contractVersion);
	if (options.onEvent) clientEventListeners.set(clientIdentity, options.onEvent);
	const skew = createSkewMonitor(contractVersion, options.onEvent);
	const boundaryDefinitions = Object.values(frameworkErrorDefinitions);
	const errorRegistry = createClientErrorRegistry(router, boundaryDefinitions);
	return createProxy(router, options.transport, options.onEvent, skew, [], /* @__PURE__ */ new Map(), clientIdentity, errorRegistry, boundaryDefinitions);
};
const createBrowserClient = (options) => {
	if (options.contract?._kind !== "router-contract") throw new TypeError("createBrowserClient expected an application contract");
	return createClientRuntime(options.contract, options);
};
//#endregion
export { createBrowserClient, createClientRuntime, getClientEventListener, getClientIdentity, getProcedureClientMetadata };

//# sourceMappingURL=client.js.map
import { DEFAULT_MAX_WIRE_BYTES, deserialize, serialize } from "../serializer.js";
import { CONTRACT_HEADER, PROTOCOL_CONTENT_TYPE, decodeBatchResponseEnvelope, isProtocolContentType } from "../protocol.js";
//#region src/client/transport.ts
const cancelled = Object.freeze({
	_tag: "control/cancelled",
	data: Object.freeze({})
});
const isCancelled = (value) => value !== null && typeof value === "object" && "_tag" in value && value._tag === "control/cancelled";
/**
* The control sentinel a shell-claimed mutation rejects with. Same family as
* `cancelled` — control flow, never part of a recoverable union — but
* distinguishable, because "you cancelled" and "an enclosing shell owns this
* outcome" are different events. Carries the claimed tag and the owning
* shell's name for diagnostics; never the error value itself.
*/
const claimed = (info) => Object.freeze({
	_tag: "control/claimed",
	data: Object.freeze({
		tag: info.tag,
		owner: info.owner
	})
});
const isClaimed = (value) => value !== null && typeof value === "object" && "_tag" in value && value._tag === "control/claimed";
const browserIsOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const readResponseBody = async (response, maxBytes) => {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) return text + decoder.decode();
			bytes += chunk.value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				return;
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}
};
const fetchTransport = (options) => ({
	request: async (envelope, requestOptions = {}) => {
		const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs ?? 3e4;
		if (requestOptions.signal?.aborted) throw cancelled;
		const timeoutController = new AbortController();
		const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
		const signal = requestOptions.signal ? AbortSignal.any([requestOptions.signal, timeoutController.signal]) : timeoutController.signal;
		const encoded = serialize(envelope, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
		if (!encoded.ok) {
			clearTimeout(timeout);
			throw new TypeError("Request envelope is not serializable");
		}
		try {
			const response = await (options.fetch ?? globalThis.fetch)(options.url, {
				method: "POST",
				headers: {
					...options.headers,
					"content-type": PROTOCOL_CONTENT_TYPE
				},
				body: encoded.value,
				signal
			});
			const body = await readResponseBody(response, options.maxResponseBytes ?? 1048576);
			const contract = response.headers.get(CONTRACT_HEADER);
			if (body === void 0) return {
				ok: true,
				response: {
					status: response.status,
					contentType: response.headers.get("content-type"),
					body: "response exceeded byte limit",
					contract
				}
			};
			return {
				ok: true,
				response: {
					status: response.status,
					contentType: response.headers.get("content-type"),
					body,
					contract
				}
			};
		} catch {
			if (requestOptions.signal?.aborted) throw cancelled;
			if (timeoutController.signal.aborted) return {
				ok: false,
				reason: "timeout",
				timeoutMs
			};
			if (browserIsOffline()) return {
				ok: false,
				reason: "offline"
			};
			return {
				ok: false,
				reason: "network"
			};
		} finally {
			clearTimeout(timeout);
		}
	},
	stream: async (envelope, requestOptions = {}) => {
		const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs ?? 3e4;
		if (requestOptions.signal?.aborted) throw cancelled;
		const timeoutController = new AbortController();
		const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
		const signal = requestOptions.signal ? AbortSignal.any([requestOptions.signal, timeoutController.signal]) : timeoutController.signal;
		const encoded = serialize(envelope, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
		if (!encoded.ok) throw new TypeError("Request envelope is not serializable");
		try {
			const response = await (options.fetch ?? globalThis.fetch)(options.url, {
				method: "POST",
				headers: {
					...options.headers,
					"content-type": PROTOCOL_CONTENT_TYPE
				},
				body: encoded.value,
				signal
			});
			clearTimeout(timeout);
			return {
				ok: true,
				response: {
					status: response.status,
					contentType: response.headers.get("content-type"),
					body: response.body,
					contract: response.headers.get(CONTRACT_HEADER)
				}
			};
		} catch {
			clearTimeout(timeout);
			if (requestOptions.signal?.aborted) throw cancelled;
			if (timeoutController.signal.aborted) return {
				ok: false,
				reason: "timeout",
				timeoutMs
			};
			if (browserIsOffline()) return {
				ok: false,
				reason: "offline"
			};
			return {
				ok: false,
				reason: "network"
			};
		}
	}
});
/** Coalesces calls made in the same microtask into one HTTP request. */
const batchFetchTransport = (options) => {
	const maxItems = options.maxItems ?? 20;
	if (!Number.isSafeInteger(maxItems) || maxItems < 1) throw new TypeError("maxItems must be a positive integer");
	let queue = [];
	let scheduled = false;
	const flush = async () => {
		scheduled = false;
		const items = queue.splice(0, maxItems);
		if (queue.length > 0) {
			scheduled = true;
			queueMicrotask(flush);
		}
		const active = items.filter((item) => {
			if (!item.options.signal?.aborted) return true;
			item.reject(cancelled);
			return false;
		});
		if (active.length === 0) return;
		const ids = active.map((_item, index) => `b${index}`);
		const encoded = serialize({
			v: 1,
			batch: active.map((item, index) => ({
				...item.envelope,
				id: ids[index]
			}))
		}, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
		if (!encoded.ok) {
			for (const item of active) item.reject(/* @__PURE__ */ new TypeError("Batch is not serializable"));
			return;
		}
		const timeoutMs = Math.min(...active.map((item) => item.options.timeoutMs ?? options.timeoutMs ?? 3e4));
		const timeoutController = new AbortController();
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			timeoutController.abort();
		}, timeoutMs);
		const abortListeners = [];
		const abortWhenDetached = () => {
			if (active.every((item) => item.options.signal?.aborted === true)) timeoutController.abort();
		};
		for (const item of active) {
			if (!item.options.signal) continue;
			item.options.signal.addEventListener("abort", abortWhenDetached, { once: true });
			abortListeners.push([item.options.signal, abortWhenDetached]);
		}
		try {
			const response = await (options.fetch ?? globalThis.fetch)(options.url, {
				method: "POST",
				headers: {
					...options.headers,
					"content-type": PROTOCOL_CONTENT_TYPE
				},
				body: encoded.value,
				signal: timeoutController.signal
			});
			const body = await readResponseBody(response, options.maxResponseBytes ?? 1048576);
			const contract = response.headers.get(CONTRACT_HEADER);
			if (body === void 0) {
				const outcome = {
					ok: true,
					response: {
						status: response.status,
						contentType: response.headers.get("content-type"),
						body: "response exceeded byte limit",
						contract
					}
				};
				for (const item of active) item.resolve(outcome);
				return;
			}
			const contentType = response.headers.get("content-type");
			const decoded = isProtocolContentType(contentType) ? deserialize(body, { maxBytes: DEFAULT_MAX_WIRE_BYTES }) : void 0;
			const batch = decoded?.ok ? decodeBatchResponseEnvelope(decoded.value) : void 0;
			if (!batch) {
				const outcome = {
					ok: true,
					response: {
						status: response.status,
						contentType,
						body,
						contract
					}
				};
				for (const item of active) if (item.options.signal?.aborted) item.reject(cancelled);
				else item.resolve(outcome);
				return;
			}
			const byId = new Map(batch.batch.map((item) => [item.id, item]));
			active.forEach((item, index) => {
				if (item.options.signal?.aborted) return item.reject(cancelled);
				const result = byId.get(ids[index]);
				if (!result) return item.resolve({
					ok: true,
					response: {
						status: 200,
						contentType,
						body: "invalid batch response",
						contract
					}
				});
				const itemBody = serialize(result.response, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
				if (!itemBody.ok) return item.reject(/* @__PURE__ */ new TypeError("Batch item is not serializable"));
				item.resolve({
					ok: true,
					response: {
						status: result.status,
						contentType: PROTOCOL_CONTENT_TYPE,
						body: itemBody.value,
						contract
					}
				});
			});
		} catch {
			const outcome = timedOut ? {
				ok: false,
				reason: "timeout",
				timeoutMs
			} : browserIsOffline() ? {
				ok: false,
				reason: "offline"
			} : {
				ok: false,
				reason: "network"
			};
			for (const item of active) if (item.options.signal?.aborted) item.reject(cancelled);
			else item.resolve(outcome);
		} finally {
			clearTimeout(timeout);
			for (const [signal, listener] of abortListeners) signal.removeEventListener("abort", listener);
		}
	};
	return {
		request: (envelope, requestOptions = {}) => new Promise((resolve, reject) => {
			if (requestOptions.signal?.aborted) return reject(cancelled);
			queue.push({
				envelope,
				options: requestOptions,
				resolve,
				reject
			});
			if (queue.length >= maxItems) flush();
			else if (!scheduled) {
				scheduled = true;
				queueMicrotask(flush);
			}
		}),
		stream: fetchTransport(options).stream
	};
};
const requestEnvelope = (path, input, lastEventId) => ({
	v: 1,
	path,
	input,
	...lastEventId === void 0 ? {} : { lastEventId }
});
//#endregion
export { batchFetchTransport, cancelled, claimed, fetchTransport, isCancelled, isClaimed, requestEnvelope };

//# sourceMappingURL=transport.js.map
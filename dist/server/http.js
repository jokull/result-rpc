import { encodeUnknownWireValue, wire } from "../wire.js";
import { DEFAULT_MAX_WIRE_BYTES, deserialize, serialize } from "../serializer.js";
import { frameworkError } from "../error.js";
import { ServerInternal, badRequestFromIssues, frameworkErrorDefinitions } from "../framework-errors.js";
import { effectiveContractVersion } from "../contract-digest.js";
import { CONTRACT_HEADER, PROTOCOL_CONTENT_TYPE, STREAM_CONTENT_TYPE, decodeBatchRequestEnvelope, decodeRequestEnvelope, decodeResponseEnvelope, isProtocolContentType } from "../protocol.js";
import { closeIterator } from "../iterator.js";
import { executeProcedure, executeSubscription } from "./contract.js";
//#region src/server/http.ts
const readRequestBody = async (request, maxBytes) => {
	if (!request.body) return "";
	const reader = request.body.getReader();
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
const streamProcedureResponse = (procedure, input, context, path, callerSignal, lastEventId, onInternalError, onError) => {
	const lifetime = new AbortController();
	const abortLifetime = () => lifetime.abort();
	if (callerSignal.aborted) abortLifetime();
	else callerSignal.addEventListener("abort", abortLifetime, { once: true });
	const iterator = executeSubscription(procedure, input, {
		context,
		procedurePath: path,
		signal: lifetime.signal,
		...lastEventId === void 0 ? {} : { lastEventId },
		...onInternalError === void 0 ? {} : { onInternalError }
	})[Symbol.asyncIterator]();
	const encoder = new TextEncoder();
	let sequence = 0;
	let settled = false;
	const detachCaller = () => callerSignal.removeEventListener("abort", abortLifetime);
	const body = new ReadableStream({
		async pull(controller) {
			if (settled) return;
			try {
				const next = await iterator.next();
				if (settled || lifetime.signal.aborted) return;
				let frame;
				let failureEvent;
				if (next.done) frame = {
					v: 1,
					seq: sequence++,
					done: true
				};
				else if (next.value.status === "ok") {
					const output = encodeUnknownWireValue(procedure._def.output, next.value.value);
					if (!output.ok) throw new TypeError("Unable to encode subscription output");
					frame = {
						v: 1,
						seq: sequence++,
						done: false,
						response: {
							v: 1,
							status: "ok",
							value: output.value
						}
					};
				} else {
					failureEvent = {
						failure: next.value.error,
						status: statusForError(procedure, next.value.error)
					};
					frame = {
						v: 1,
						seq: sequence++,
						done: false,
						response: {
							v: 1,
							status: "error",
							error: next.value.error.toJSON()
						}
					};
				}
				const encoded = serialize(frame, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
				if (!encoded.ok) throw new TypeError("Unable to encode subscription frame");
				controller.enqueue(encoder.encode(`${encoded.value}\n`));
				if (failureEvent) onError?.(failureEvent.failure, failureEvent.status);
				if (next.done || next.value.status === "error") {
					settled = true;
					detachCaller();
					abortLifetime();
					await closeIterator(iterator);
					controller.close();
				}
			} catch (cause) {
				if (settled || lifetime.signal.aborted) return;
				settled = true;
				detachCaller();
				const incidentId = `inc_${crypto.randomUUID()}`;
				onInternalError?.({
					incidentId,
					phase: "handler",
					cause,
					procedurePath: path
				});
				const failure = ServerInternal({ incidentId });
				const encoded = serialize({
					v: 1,
					seq: sequence++,
					done: false,
					response: {
						v: 1,
						status: "error",
						error: failure.toJSON()
					}
				});
				if (encoded.ok) {
					controller.enqueue(encoder.encode(`${encoded.value}\n`));
					onError?.(failure, ServerInternal.policy.httpStatus ?? 500);
				}
				controller.close();
			}
		},
		async cancel() {
			if (settled) return;
			settled = true;
			detachCaller();
			abortLifetime();
			await closeIterator(iterator);
		}
	});
	return new Response(body, {
		status: 200,
		headers: { "content-type": STREAM_CONTENT_TYPE }
	});
};
const ProtocolInvalidRequest = frameworkError({
	tag: "protocol/invalid-request",
	data: wire.object({}),
	httpStatus: 400,
	retry: "never",
	visibility: "public"
});
const ProtocolNotFound = frameworkError({
	tag: "protocol/procedure-not-found",
	data: wire.object({}),
	httpStatus: 404,
	retry: "never",
	visibility: "public"
});
const wireResponse = (envelope, status) => {
	const encoded = serialize(envelope, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
	if (!encoded.ok) throw new TypeError(`Unable to encode response envelope: ${encoded.message}`);
	return new Response(encoded.value, {
		status,
		headers: { "content-type": PROTOCOL_CONTENT_TYPE }
	});
};
const statusForError = (procedure, failure) => {
	if (ServerInternal.is(failure)) return ServerInternal.policy.httpStatus ?? 500;
	const definition = Object.values(procedure._def.definitions).find((candidate) => candidate.tag === failure._tag);
	if (!definition) return 500;
	return definition.policy.httpStatus ?? 200;
};
const frameworkPolicyFor = (failure) => [
	...Object.values(frameworkErrorDefinitions),
	ProtocolInvalidRequest,
	ProtocolNotFound
].find((definition) => definition.tag === failure._tag)?.policy;
const definitionPolicyFor = (router, procedurePath, failure) => {
	const procedure = router.procedures.get(procedurePath);
	if (!procedure) return void 0;
	return Object.values(procedure._def.definitions).find((definition) => definition.tag === failure._tag)?.policy;
};
const encodeProcedureResult = (procedure, result, finalizeFailure, touched = []) => {
	const touchedField = touched.length === 0 ? {} : { touched };
	if (result.status === "error") {
		const status = statusForError(procedure, result.error);
		return finalizeFailure(result.error, status, touched);
	}
	const encoded = encodeUnknownWireValue(procedure._def.output, result.value);
	if (!encoded.ok) throw new TypeError("Unable to encode procedure output");
	return wireResponse({
		v: 1,
		status: "ok",
		value: encoded.value,
		...touchedField
	}, 200);
};
const createFetchHandler = (options) => {
	const endpoint = options.endpoint ?? "/rpc";
	const maxBatchItems = options.maxBatchItems ?? 20;
	const maxRequestBytes = options.maxRequestBytes ?? 1048576;
	if (!Number.isSafeInteger(maxBatchItems) || maxBatchItems < 1) throw new TypeError("maxBatchItems must be a positive integer");
	if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) throw new TypeError("maxRequestBytes must be a positive integer");
	const contractVersion = effectiveContractVersion(options.router, options.contractVersion);
	const notify = (failure, httpStatus, procedurePath) => {
		const policy = frameworkPolicyFor(failure) ?? (procedurePath === void 0 ? void 0 : definitionPolicyFor(options.router, procedurePath, failure));
		options.onError?.({
			error: failure,
			...policy === void 0 ? {} : { policy },
			...procedurePath === void 0 ? {} : { procedurePath },
			httpStatus
		});
	};
	const finalizeFailure = (failure, httpStatus, procedurePath, touched = []) => {
		const response = wireResponse({
			v: 1,
			status: "error",
			error: failure.toJSON(),
			...touched.length === 0 ? {} : { touched }
		}, httpStatus);
		notify(failure, httpStatus, procedurePath);
		return response;
	};
	const handle = async (request, responseHeaders) => {
		const failWith = (failure, httpStatus, procedurePath) => {
			return finalizeFailure(failure, httpStatus, procedurePath);
		};
		if (new URL(request.url).pathname !== endpoint || request.method !== "POST") return failWith(ProtocolNotFound({}), 404);
		if (!isProtocolContentType(request.headers.get("content-type"))) return failWith(ProtocolInvalidRequest({}), 400);
		const body = await readRequestBody(request, maxRequestBytes);
		if (body === void 0) return failWith(ProtocolInvalidRequest({}), 400);
		const decodedBody = deserialize(body, { maxBytes: maxRequestBytes });
		if (!decodedBody.ok) return failWith(ProtocolInvalidRequest({}), 400);
		const raw = decodedBody.value;
		const envelope = decodeRequestEnvelope(raw);
		const batch = envelope ? void 0 : decodeBatchRequestEnvelope(raw);
		if (!envelope && !batch) return failWith(ProtocolInvalidRequest({}), 400);
		if (batch && batch.batch.length > maxBatchItems) return failWith(ProtocolInvalidRequest({}), 400);
		let context;
		try {
			context = await options.createContext({ request });
		} catch (cause) {
			const incidentId = `inc_${crypto.randomUUID()}`;
			options.onInternalError?.({
				incidentId,
				phase: "context",
				cause,
				...envelope === void 0 ? {} : { procedurePath: envelope.path }
			});
			return failWith(ServerInternal({ incidentId }), ServerInternal.policy.httpStatus ?? 500, envelope?.path);
		}
		if (envelope) {
			const subscription = options.router.procedures.get(envelope.path);
			if (subscription?._kind === "subscription-procedure") {
				let decodedInput;
				try {
					decodedInput = subscription._def.input.decode(envelope.input);
				} catch (cause) {
					const incidentId = `inc_${crypto.randomUUID()}`;
					options.onInternalError?.({
						incidentId,
						phase: "input",
						cause,
						procedurePath: envelope.path
					});
					return failWith(ServerInternal({ incidentId }), ServerInternal.policy.httpStatus ?? 500, envelope.path);
				}
				if (!decodedInput.ok) return failWith(badRequestFromIssues(decodedInput.issues), 400, envelope.path);
				return streamProcedureResponse(subscription, decodedInput.value, context, envelope.path, request.signal, subscription._def.resumable === void 0 ? void 0 : envelope.lastEventId, options.onInternalError, (failure, status) => notify(failure, status, envelope.path));
			}
		}
		const dispatch = async (item) => {
			const procedure = options.router.procedures.get(item.path);
			if (!procedure) return failWith(ProtocolNotFound({}), 404, item.path);
			if (procedure._kind === "subscription-procedure") return failWith(ProtocolInvalidRequest({}), 400, item.path);
			let decodedInput;
			try {
				decodedInput = procedure._def.input.decode(item.input);
			} catch (cause) {
				const incidentId = `inc_${crypto.randomUUID()}`;
				options.onInternalError?.({
					incidentId,
					phase: "input",
					cause,
					procedurePath: item.path
				});
				return failWith(ServerInternal({ incidentId }), ServerInternal.policy.httpStatus ?? 500, item.path);
			}
			if (!decodedInput.ok) return failWith(badRequestFromIssues(decodedInput.issues), 400, item.path);
			const touched = [];
			const result = await executeProcedure(procedure, decodedInput.value, {
				context,
				procedurePath: item.path,
				signal: request.signal,
				responseHeaders,
				onTouch: (key) => void touched.push(key),
				...options.onInternalError === void 0 ? {} : { onInternalError: options.onInternalError }
			});
			try {
				return encodeProcedureResult(procedure, result, (failure, status, failureTouched) => finalizeFailure(failure, status, item.path, failureTouched), touched);
			} catch (cause) {
				const incidentId = `inc_${crypto.randomUUID()}`;
				options.onInternalError?.({
					incidentId,
					phase: "output",
					cause,
					procedurePath: item.path
				});
				return failWith(ServerInternal({ incidentId }), ServerInternal.policy.httpStatus ?? 500, item.path);
			}
		};
		if (envelope) return dispatch(envelope);
		const items = await Promise.all(batch.batch.map(async (item) => {
			const response = await dispatch(item);
			const decoded = deserialize(await response.text(), { maxBytes: DEFAULT_MAX_WIRE_BYTES });
			if (!decoded.ok) throw new TypeError("Unable to decode an internal batch item");
			const responseEnvelope = decodeResponseEnvelope(decoded.value);
			if (!responseEnvelope) throw new TypeError("Invalid internal batch response envelope");
			return {
				id: item.id,
				status: response.status,
				response: responseEnvelope
			};
		}));
		return wireResponse({
			v: 1,
			batch: items
		}, 200);
	};
	return async (request) => {
		const responseHeaders = new Headers();
		let response;
		try {
			response = await handle(request, responseHeaders);
		} catch (cause) {
			if (request.signal.aborted) throw cause;
			const incidentId = `inc_${crypto.randomUUID()}`;
			options.onInternalError?.({
				incidentId,
				phase: "output",
				cause
			});
			const failure = ServerInternal({ incidentId });
			response = finalizeFailure(failure, ServerInternal.policy.httpStatus ?? 500);
		}
		for (const [name, value] of responseHeaders) response.headers.append(name, value);
		response.headers.set(CONTRACT_HEADER, contractVersion);
		return response;
	};
};
//#endregion
export { createFetchHandler };

//# sourceMappingURL=http.js.map
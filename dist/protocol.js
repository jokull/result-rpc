import { isWireValue } from "./wire.js";
//#region src/protocol.ts
const PROTOCOL_VERSION = 1;
const PROTOCOL_CONTENT_TYPE = "application/result-rpc+devalue; sv=1";
const STREAM_CONTENT_TYPE = "application/result-rpc-stream+devalue; sv=1";
/** Response header carrying the server's contract digest, for skew detection. */
const CONTRACT_HEADER = "x-result-rpc-contract";
const matchesContentType = (value, mediaType) => {
	if (value === null) return false;
	const [type, ...parameters] = value.toLowerCase().split(";").map((part) => part.trim());
	const serializerVersions = parameters.filter((parameter) => parameter.startsWith("sv="));
	return type === mediaType && serializerVersions.length === 1 && serializerVersions[0] === "sv=1";
};
const isProtocolContentType = (value) => matchesContentType(value, "application/result-rpc+devalue");
const isStreamContentType = (value) => matchesContentType(value, "application/result-rpc-stream+devalue");
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const touchedOf = (value) => {
	if (!("touched" in value)) return void 0;
	return Array.isArray(value.touched) && value.touched.every((entry) => typeof entry === "string") ? value.touched : false;
};
const decodeRequestEnvelope = (value) => {
	if (!isRecord(value) || value.v !== 1 || typeof value.path !== "string") return;
	if (!("input" in value) || !isWireValue(value.input)) return void 0;
	if ("lastEventId" in value && typeof value.lastEventId !== "string") return void 0;
	return {
		v: 1,
		path: value.path,
		input: value.input,
		...typeof value.lastEventId === "string" ? { lastEventId: value.lastEventId } : {}
	};
};
const decodeBatchRequestEnvelope = (value) => {
	if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.batch)) return;
	const batch = [];
	for (const item of value.batch) {
		const envelope = decodeRequestEnvelope(item);
		if (!envelope || !isRecord(item) || typeof item.id !== "string") return void 0;
		batch.push({
			...envelope,
			id: item.id
		});
	}
	return {
		v: 1,
		batch
	};
};
const decodeResponseEnvelope = (value) => {
	if (!isRecord(value) || value.v !== 1 || typeof value.status !== "string" || value.status !== "ok" && value.status !== "error") return;
	const touched = touchedOf(value);
	if (touched === false) return void 0;
	if (value.status === "ok" && "value" in value && isWireValue(value.value)) return {
		v: 1,
		status: "ok",
		value: value.value,
		...touched === void 0 ? {} : { touched }
	};
	if (value.status === "error" && isRecord(value.error) && typeof value.error._tag === "string" && "data" in value.error && isWireValue(value.error.data)) return {
		v: 1,
		status: "error",
		error: {
			_tag: value.error._tag,
			data: value.error.data
		},
		...touched === void 0 ? {} : { touched }
	};
};
const decodeBatchResponseEnvelope = (value) => {
	if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.batch)) return;
	const batch = [];
	for (const item of value.batch) {
		if (!isRecord(item) || typeof item.id !== "string" || typeof item.status !== "number") return;
		const response = decodeResponseEnvelope(item.response);
		if (!response) return void 0;
		batch.push({
			id: item.id,
			status: item.status,
			response
		});
	}
	return {
		v: 1,
		batch
	};
};
const decodeStreamFrame = (value) => {
	if (!isRecord(value) || value.v !== 1 || typeof value.seq !== "number" || !Number.isSafeInteger(value.seq) || typeof value.done !== "boolean") return void 0;
	if (value.done) return {
		v: 1,
		seq: value.seq,
		done: true
	};
	const response = decodeResponseEnvelope(value.response);
	return response === void 0 ? void 0 : {
		v: 1,
		seq: value.seq,
		done: false,
		response
	};
};
//#endregion
export { CONTRACT_HEADER, PROTOCOL_CONTENT_TYPE, PROTOCOL_VERSION, STREAM_CONTENT_TYPE, decodeBatchRequestEnvelope, decodeBatchResponseEnvelope, decodeRequestEnvelope, decodeResponseEnvelope, decodeStreamFrame, isProtocolContentType, isStreamContentType };

//# sourceMappingURL=protocol.js.map
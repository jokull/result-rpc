import type { AnyTaggedError , ErrorPolicy } from "../error.js";
import { frameworkError as error } from "../error.js";
import { badRequestFromIssues, frameworkErrorDefinitions, ServerInternal } from "../framework-errors.js";
import { contractDigest } from "../contract-digest.js";
import { injectFiles } from "../files.js";
import {
  CONTRACT_HEADER,
  PROTOCOL_CONTENT_TYPE,
  PROTOCOL_VERSION,
  STREAM_CONTENT_TYPE,
  decodeBatchRequestEnvelope,
  decodeRequestEnvelope,
  isProtocolContentType,
  type BatchResponseEnvelope,
  type FailureEnvelope,
  type ResponseEnvelope,
} from "../protocol.js";
import type { Result } from "../result.js";
import {
  DEFAULT_MAX_WIRE_BYTES,
  deserialize,
  serialize,
} from "../serializer.js";
import { wire } from "../wire.js";
import {
  executeProcedure,
  executeSubscription,
  type AnyProcedure,
  type AnySubscriptionProcedure,
  type InternalErrorEvent,
  type ErrorDefinitionMap,
  type Router,
  type RouterContext,
  type RouterRecord,
} from "./contract.js";

const readRequestBody = async (
  request: Request,
  maxBytes: number,
): Promise<string | undefined> => {
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
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
};

const streamProcedureResponse = (
  procedure: AnySubscriptionProcedure,
  input: unknown,
  context: unknown,
  path: string,
  onInternalError?: (event: InternalErrorEvent) => void,
): Response => {
  const iterator = executeSubscription(procedure, input, {
    context,
    procedurePath: path,
    ...(onInternalError === undefined ? {} : { onInternalError }),
  })[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let sequence = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        let frame;
        if (next.done) {
          frame = { v: PROTOCOL_VERSION, seq: sequence++, done: true as const };
        } else if (next.value.ok) {
          const output = procedure._def.output.encode(next.value.value);
          if (!output.ok) throw new TypeError("Unable to encode subscription output");
          frame = {
            v: PROTOCOL_VERSION,
            seq: sequence++,
            done: false as const,
            response: { v: PROTOCOL_VERSION, ok: true as const, value: output.value },
          };
        } else {
          frame = {
            v: PROTOCOL_VERSION,
            seq: sequence++,
            done: false as const,
            response: { v: PROTOCOL_VERSION, ok: false as const, error: next.value.error },
          };
        }
        const encoded = serialize(frame, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
        if (!encoded.ok) throw new TypeError("Unable to encode subscription frame");
        controller.enqueue(encoder.encode(`${encoded.value}\n`));
        if (next.done || (!next.value.ok)) controller.close();
      } catch (cause) {
        const incidentId = `inc_${crypto.randomUUID()}`;
        onInternalError?.({ incidentId, phase: "handler", cause, procedurePath: path });
        const encoded = serialize({
          v: PROTOCOL_VERSION,
          seq: sequence++,
          done: false,
          response: { v: PROTOCOL_VERSION, ok: false, error: ServerInternal({ incidentId }) },
        });
        if (encoded.ok) controller.enqueue(encoder.encode(`${encoded.value}\n`));
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.(undefined as never);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": STREAM_CONTENT_TYPE },
  });
};

const ProtocolInvalidRequest = error({
  tag: "protocol/invalid-request",
  data: wire.object({}),
  httpStatus: 400,
  retry: "never",
  visibility: "public",
});

const ProtocolNotFound = error({
  tag: "protocol/procedure-not-found",
  data: wire.object({}),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
});

const wireResponse = (
  envelope: ResponseEnvelope | BatchResponseEnvelope,
  status: number,
): Response => {
  const encoded = serialize(envelope, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
  if (!encoded.ok) {
    const incidentId = `inc_${crypto.randomUUID()}`;
    const fallback = serialize({
      v: PROTOCOL_VERSION,
      ok: false,
      error: ServerInternal({ incidentId }),
    } satisfies FailureEnvelope);
    if (!fallback.ok) throw new TypeError("Unable to encode the static internal failure");
    return new Response(fallback.value, {
      status: 500,
      headers: { "content-type": PROTOCOL_CONTENT_TYPE },
    });
  }
  return new Response(encoded.value, {
    status,
    headers: { "content-type": PROTOCOL_CONTENT_TYPE },
  });
};

const failureResponse = (
  failure: AnyTaggedError,
  status: number,
): Response => wireResponse({ v: PROTOCOL_VERSION, ok: false, error: failure }, status);

const statusForError = (procedure: AnyProcedure, failure: AnyTaggedError): number => {
  if (ServerInternal.is(failure)) return ServerInternal.policy.httpStatus;
  const definitions = procedure._def.definitions as ErrorDefinitionMap;
  const definition = Object.values(definitions).find(
    (candidate) => candidate.tag === failure._tag,
  );
  return definition?.policy.httpStatus ?? 500;
};

const frameworkPolicyFor = (failure: AnyTaggedError): ErrorPolicy | undefined =>
  Object.values(frameworkErrorDefinitions)
    .find((definition) => definition.tag === failure._tag)?.policy;

const definitionPolicyFor = (
  router: Router<unknown, RouterRecord>,
  procedurePath: string,
  failure: AnyTaggedError,
): ErrorPolicy | undefined => {
  const procedure = router.procedures.get(procedurePath);
  if (!procedure) return undefined;
  return Object.values(procedure._def.definitions as ErrorDefinitionMap)
    .find((definition) => definition.tag === failure._tag)?.policy;
};

const encodeProcedureResult = (
  procedure: AnyProcedure,
  result: Result<unknown, AnyTaggedError>,
  notify?: (failure: AnyTaggedError, httpStatus: number) => void,
  touched: readonly string[] = [],
): Response => {
  const touchedField = touched.length === 0 ? {} : { touched };
  if (!result.ok) {
    const status = statusForError(procedure, result.error);
    notify?.(result.error, status);
    return wireResponse(
      { v: PROTOCOL_VERSION, ok: false, error: result.error, ...touchedField },
      status,
    );
  }
  const encoded = procedure._def.output.encode(result.value);
  if (!encoded.ok) {
    const fallback = ServerInternal({ incidentId: `inc_${crypto.randomUUID()}` });
    return failureResponse(fallback, 500);
  }
  return wireResponse({ v: PROTOCOL_VERSION, ok: true, value: encoded.value, ...touchedField }, 200);
};

export interface FetchHandlerOptions<TRouter extends Router<any, RouterRecord>> {
  readonly router: TRouter;
  readonly endpoint?: string;
  readonly maxBatchItems?: number;
  readonly maxRequestBytes?: number;
  readonly createContext: (options: {
    readonly request: Request;
  }) => RouterContext<TRouter> | Promise<RouterContext<TRouter>>;
  readonly onInternalError?: (event: InternalErrorEvent) => void;
  /**
   * Observability tap for every declared error that crosses the wire —
   * domain errors, bad requests, and sanitized internals alike. Receives the
   * error value plus its policy (severity, retry, status), so one hook feeds
   * metrics and logging without re-deriving anything. Defects additionally
   * fire `onInternalError` with the full cause.
   */
  readonly onError?: (event: ErrorResponseEvent) => void;
  /**
   * Overrides the automatic contract digest sent on every response for stale-
   * client detection (e.g. a build stamp). Set the same value on the client.
   */
  readonly contractVersion?: string;
}

export interface ErrorResponseEvent {
  readonly error: AnyTaggedError;
  readonly policy?: ErrorPolicy;
  readonly procedurePath?: string;
  readonly httpStatus: number;
}

export const createFetchHandler = <TRouter extends Router<any, RouterRecord>>(
  options: FetchHandlerOptions<TRouter>,
): ((request: Request) => Promise<Response>) => {
  const endpoint = options.endpoint ?? "/rpc";
  const maxBatchItems = options.maxBatchItems ?? 20;
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_WIRE_BYTES;
  if (!Number.isSafeInteger(maxBatchItems) || maxBatchItems < 1) {
    throw new TypeError("maxBatchItems must be a positive integer");
  }
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) {
    throw new TypeError("maxRequestBytes must be a positive integer");
  }
  const contractVersion = options.contractVersion ?? contractDigest(options.router);
  const handle = async (request: Request): Promise<Response> => {
    const notify = (failure: AnyTaggedError, httpStatus: number, procedurePath?: string) => {
      const policy = frameworkPolicyFor(failure)
        ?? (procedurePath === undefined
          ? undefined
          : definitionPolicyFor(options.router, procedurePath, failure));
      options.onError?.({
        error: failure,
        ...(policy === undefined ? {} : { policy }),
        ...(procedurePath === undefined ? {} : { procedurePath }),
        httpStatus,
      });
    };
    const failWith = (failure: AnyTaggedError, httpStatus: number, procedurePath?: string) => {
      notify(failure, httpStatus, procedurePath);
      return failureResponse(failure, httpStatus);
    };
    const url = new URL(request.url);
    if (url.pathname !== endpoint || request.method !== "POST") {
      return failWith(ProtocolNotFound({}), 404);
    }
    const contentTypeHeader = request.headers.get("content-type");
    const isMultipart = contentTypeHeader?.toLowerCase().startsWith("multipart/form-data") ?? false;
    if (!isMultipart && !isProtocolContentType(contentTypeHeader)) {
      return failWith(ProtocolInvalidRequest({}), 400);
    }

    // Multipart requests carry the envelope as a form field plus numbered
    // file parts; markers inside the input resolve to those parts below.
    let body: string | undefined;
    let fileParts: readonly Blob[] = [];
    if (isMultipart) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return failWith(ProtocolInvalidRequest({}), 400);
      }
      const envelopeField = form.get("envelope");
      if (typeof envelopeField !== "string" || envelopeField.length > maxRequestBytes) {
        return failWith(ProtocolInvalidRequest({}), 400);
      }
      body = envelopeField;
      const parts: Blob[] = [];
      for (let index = 0; ; index += 1) {
        const part = form.get(String(index));
        if (part === null) break;
        if (typeof part === "string") return failWith(ProtocolInvalidRequest({}), 400);
        parts.push(part);
      }
      fileParts = parts;
    } else {
      body = await readRequestBody(request, maxRequestBytes);
    }
    if (body === undefined) return failWith(ProtocolInvalidRequest({}), 400);
    const decodedBody = deserialize(body, { maxBytes: maxRequestBytes });
    if (!decodedBody.ok) return failWith(ProtocolInvalidRequest({}), 400);
    let raw = decodedBody.value;
    if (fileParts.length > 0) {
      const injected = injectFiles(raw, fileParts);
      if (injected === undefined) return failWith(ProtocolInvalidRequest({}), 400);
      raw = injected as typeof raw;
    }
    const envelope = decodeRequestEnvelope(raw);
    const batch = envelope || isMultipart ? undefined : decodeBatchRequestEnvelope(raw);
    if (!envelope && !batch) return failWith(ProtocolInvalidRequest({}), 400);
    if (batch && batch.batch.length > maxBatchItems) {
      return failureResponse(ProtocolInvalidRequest({}), 400);
    }

    let context: RouterContext<TRouter>;
    try {
      context = await options.createContext({ request });
    } catch (cause) {
      const incidentId = `inc_${crypto.randomUUID()}`;
      options.onInternalError?.({
        incidentId,
        phase: "context",
        cause,
        ...(envelope === undefined ? {} : { procedurePath: envelope.path }),
      });
      return failureResponse(ServerInternal({ incidentId }), 500);
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
            procedurePath: envelope.path,
          });
          return failureResponse(ServerInternal({ incidentId }), 500);
        }
        if (!decodedInput.ok) return failWith(badRequestFromIssues(decodedInput.issues), 400, envelope.path);
        return streamProcedureResponse(
          subscription,
          decodedInput.value,
          context,
          envelope.path,
          options.onInternalError,
        );
      }
    }

    const dispatch = async (item: { readonly path: string; readonly input: unknown }) => {
      const procedure = options.router.procedures.get(item.path);
      if (!procedure) return failWith(ProtocolNotFound({}), 404, item.path);
      if (procedure._kind === "subscription-procedure") {
        return failureResponse(ProtocolInvalidRequest({}), 400);
      }
      let decodedInput;
      try {
        decodedInput = procedure._def.input.decode(item.input);
      } catch (cause) {
        const incidentId = `inc_${crypto.randomUUID()}`;
        options.onInternalError?.({
          incidentId,
          phase: "input",
          cause,
          procedurePath: item.path,
        });
        return failureResponse(ServerInternal({ incidentId }), 500);
      }
      if (!decodedInput.ok) return failWith(badRequestFromIssues(decodedInput.issues), 400, item.path);
      const touched: string[] = [];
      const result = await executeProcedure(procedure, decodedInput.value, {
        context,
        procedurePath: item.path,
        onTouch: (key) => void touched.push(key),
        ...(options.onInternalError === undefined
          ? {}
          : { onInternalError: options.onInternalError }),
      });
      try {
        return encodeProcedureResult(procedure, result, (failure, status) =>
          notify(failure, status, item.path), touched);
      } catch (cause) {
        const incidentId = `inc_${crypto.randomUUID()}`;
        options.onInternalError?.({
          incidentId,
          phase: "output",
          cause,
          procedurePath: item.path,
        });
        return failureResponse(ServerInternal({ incidentId }), 500);
      }
    };

    if (envelope) return dispatch(envelope);

    const items = await Promise.all(batch!.batch.map(async (item) => {
      const response = await dispatch(item);
      const decoded = deserialize(await response.text(), { maxBytes: DEFAULT_MAX_WIRE_BYTES });
      if (!decoded.ok) throw new TypeError("Unable to decode an internal batch item");
      return {
        id: item.id,
        status: response.status,
        response: decoded.value as ResponseEnvelope,
      };
    }));
    return wireResponse({ v: PROTOCOL_VERSION, batch: items }, 200);
  };
  return async (request) => {
    const response = await handle(request);
    response.headers.set(CONTRACT_HEADER, contractVersion);
    return response;
  };
};

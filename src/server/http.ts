import type { AnyTaggedError, ErrorPolicy } from "../error.js";
import { frameworkError as error } from "../error.js";
import {
  badRequestFromIssues,
  frameworkErrorDefinitions,
  ServerInternal,
} from "../framework-errors.js";
import { effectiveContractVersion, type EffectiveContractVersion } from "../contract-digest.js";
import {
  CONTRACT_HEADER,
  PROTOCOL_CONTENT_TYPE,
  PROTOCOL_VERSION,
  STREAM_CONTENT_TYPE,
  decodeBatchRequestEnvelope,
  decodeRequestEnvelope,
  decodeResponseEnvelope,
  isProtocolContentType,
  type BatchResponseEnvelope,
  type ResponseEnvelope,
} from "../protocol.js";
import type { Result } from "../result.js";
import { DEFAULT_MAX_WIRE_BYTES, deserialize, serialize } from "../serializer.js";
import { encodeUnknownWireValue, wire } from "../wire.js";
import {
  executeProcedure,
  executeSubscription,
  type AnyProcedure,
  type AnyRouter,
  type AnySubscriptionProcedure,
  type InternalErrorEvent,
  type RouterContext,
} from "./contract.js";
import { closeIterator } from "../iterator.js";

const readRequestBody = async (request: Request, maxBytes: number): Promise<string | undefined> => {
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
  callerSignal: AbortSignal,
  lastEventId: string | undefined,
  onInternalError?: (event: InternalErrorEvent) => void,
  onError?: (failure: AnyTaggedError, httpStatus: number) => void,
): Response => {
  // The generator's lifetime signal: aborts when the request aborts (client
  // disconnected) or when the response stream is cancelled — so a handler
  // awaiting slow upstream work stops with the caller instead of running on.
  const lifetime = new AbortController();
  const abortLifetime = () => lifetime.abort();
  if (callerSignal.aborted) abortLifetime();
  else callerSignal.addEventListener("abort", abortLifetime, { once: true });
  const iterator = executeSubscription(procedure, input, {
    context,
    procedurePath: path,
    signal: lifetime.signal,
    ...(lastEventId === undefined ? {} : { lastEventId }),
    ...(onInternalError === undefined ? {} : { onInternalError }),
  })[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let sequence = 0;
  let settled = false;
  const detachCaller = () => callerSignal.removeEventListener("abort", abortLifetime);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (settled) return;
      try {
        const next = await iterator.next();
        // cancel() may have run while the producer was awaiting upstream IO.
        // A closed ReadableStream controller must never receive another frame.
        if (settled || lifetime.signal.aborted) return;
        let frame;
        let failureEvent: { readonly failure: AnyTaggedError; readonly status: number } | undefined;
        if (next.done) {
          frame = { v: PROTOCOL_VERSION, seq: sequence++, done: true as const };
        } else if (next.value.ok) {
          const output = encodeUnknownWireValue(procedure._def.output, next.value.value);
          if (!output.ok) throw new TypeError("Unable to encode subscription output");
          frame = {
            v: PROTOCOL_VERSION,
            seq: sequence++,
            done: false as const,
            response: { v: PROTOCOL_VERSION, ok: true as const, value: output.value },
          };
        } else {
          failureEvent = {
            failure: next.value.error,
            status: statusForError(procedure, next.value.error),
          };
          frame = {
            v: PROTOCOL_VERSION,
            seq: sequence++,
            done: false as const,
            response: {
              v: PROTOCOL_VERSION,
              ok: false as const,
              error: next.value.error.toJSON(),
            },
          };
        }
        const encoded = serialize(frame, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
        if (!encoded.ok) throw new TypeError("Unable to encode subscription frame");
        controller.enqueue(encoder.encode(`${encoded.value}\n`));
        if (failureEvent) onError?.(failureEvent.failure, failureEvent.status);
        if (next.done || !next.value.ok) {
          settled = true;
          detachCaller();
          // The generator is parked at its last `yield` and nothing will resume
          // it, so returning it is the only thing that runs the handler's
          // `finally` — a db cursor, a pub/sub unsubscribe, a lock. `cancel()`
          // does the same for the client-disconnect path.
          abortLifetime();
          await closeIterator(iterator);
          controller.close();
        }
      } catch (cause) {
        if (settled || lifetime.signal.aborted) return;
        settled = true;
        detachCaller();
        const incidentId = `inc_${crypto.randomUUID()}`;
        onInternalError?.({ incidentId, phase: "handler", cause, procedurePath: path });
        const failure = ServerInternal({ incidentId });
        const encoded = serialize({
          v: PROTOCOL_VERSION,
          seq: sequence++,
          done: false,
          response: {
            v: PROTOCOL_VERSION,
            ok: false,
            error: failure.toJSON(),
          },
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
    throw new TypeError(`Unable to encode response envelope: ${encoded.message}`);
  }
  return new Response(encoded.value, {
    status,
    headers: { "content-type": PROTOCOL_CONTENT_TYPE },
  });
};

const statusForError = (procedure: AnyProcedure, failure: AnyTaggedError): number => {
  if (ServerInternal.is(failure)) return ServerInternal.policy.httpStatus ?? 500;
  const definition = Object.values(procedure._def.definitions).find(
    (candidate) => candidate.tag === failure._tag,
  );
  if (!definition) return 500;
  return definition.policy.httpStatus ?? 200;
};

const frameworkPolicyFor = (failure: AnyTaggedError): ErrorPolicy | undefined =>
  [...Object.values(frameworkErrorDefinitions), ProtocolInvalidRequest, ProtocolNotFound].find(
    (definition) => definition.tag === failure._tag,
  )?.policy;

const definitionPolicyFor = (
  router: AnyRouter,
  procedurePath: string,
  failure: AnyTaggedError,
): ErrorPolicy | undefined => {
  const procedure = router.procedures.get(procedurePath);
  if (!procedure) return undefined;
  return Object.values(procedure._def.definitions).find(
    (definition) => definition.tag === failure._tag,
  )?.policy;
};

const encodeProcedureResult = (
  procedure: AnyProcedure,
  result: Result<unknown, AnyTaggedError>,
  finalizeFailure: (
    failure: AnyTaggedError,
    httpStatus: number,
    touched: readonly string[],
  ) => Response,
  touched: readonly string[] = [],
): Response => {
  const touchedField = touched.length === 0 ? {} : { touched };
  if (!result.ok) {
    const status = statusForError(procedure, result.error);
    return finalizeFailure(result.error, status, touched);
  }
  const encoded = encodeUnknownWireValue(procedure._def.output, result.value);
  if (!encoded.ok) {
    throw new TypeError("Unable to encode procedure output");
  }
  return wireResponse(
    { v: PROTOCOL_VERSION, ok: true, value: encoded.value, ...touchedField },
    200,
  );
};

export interface FetchHandlerOptions<TRouter extends AnyRouter> {
  readonly router: TRouter;
  readonly endpoint?: string;
  readonly maxBatchItems?: number;
  readonly maxRequestBytes?: number;
  /**
   * Builds the per-request context. Note what is absent: response headers.
   * Writing one is a declared capability — a procedure calls `.headers()` and
   * receives `context.headers` — so that the contract records which calls
   * cannot have their response headers sent before the handler finishes.
   */
  readonly createContext: (options: {
    readonly request: Request;
  }) => RouterContext<TRouter> | Promise<RouterContext<TRouter>>;
  readonly onInternalError?: (event: InternalErrorEvent) => void;
  /**
   * Observability tap for every declared error that crosses the wire —
   * domain errors, bad requests, and sanitized internals alike. Receives the
   * error value plus its policy and the operation's HTTP status projection,
   * so one hook feeds
   * metrics and logging without re-deriving anything. Defects additionally
   * fire `onInternalError` with the full cause. Batch and streaming envelopes
   * can remain HTTP 200 while this event carries the individual operation's
   * projected status.
   */
  readonly onError?: (event: ErrorResponseEvent) => void;
  /**
   * Overrides the automatic contract digest to form the effective version sent
   * on every response for stale-
   * client detection (e.g. a build stamp). Set the same value on the client.
   */
  readonly contractVersion?: EffectiveContractVersion;
}

export interface ErrorResponseEvent {
  readonly error: AnyTaggedError;
  readonly policy?: ErrorPolicy;
  readonly procedurePath?: string;
  readonly httpStatus: number;
}

export const createFetchHandler = <TRouter extends AnyRouter>(
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
  const contractVersion = effectiveContractVersion(options.router, options.contractVersion);
  const notify = (failure: AnyTaggedError, httpStatus: number, procedurePath?: string) => {
    const policy =
      frameworkPolicyFor(failure) ??
      (procedurePath === undefined
        ? undefined
        : definitionPolicyFor(options.router, procedurePath, failure));
    options.onError?.({
      error: failure,
      ...(policy === undefined ? {} : { policy }),
      ...(procedurePath === undefined ? {} : { procedurePath }),
      httpStatus,
    });
  };
  const finalizeFailure = (
    failure: AnyTaggedError,
    httpStatus: number,
    procedurePath?: string,
    touched: readonly string[] = [],
  ): Response => {
    const response = wireResponse(
      {
        v: PROTOCOL_VERSION,
        ok: false,
        error: failure.toJSON(),
        ...(touched.length === 0 ? {} : { touched }),
      },
      httpStatus,
    );
    notify(failure, httpStatus, procedurePath);
    return response;
  };
  const handle = async (request: Request, responseHeaders: Headers): Promise<Response> => {
    const failWith = (failure: AnyTaggedError, httpStatus: number, procedurePath?: string) => {
      return finalizeFailure(failure, httpStatus, procedurePath);
    };
    const url = new URL(request.url);
    if (url.pathname !== endpoint || request.method !== "POST") {
      return failWith(ProtocolNotFound({}), 404);
    }
    const contentTypeHeader = request.headers.get("content-type");
    // The protocol content-type is required on every request. It is not a
    // CORS "simple" type, so a browser cannot send it cross-origin without a
    // preflight the server never grants — that is the CSRF defense, and it is
    // uniform because there is no upload path that speaks a simpler type.
    if (!isProtocolContentType(contentTypeHeader)) {
      return failWith(ProtocolInvalidRequest({}), 400);
    }
    const body = await readRequestBody(request, maxRequestBytes);
    if (body === undefined) return failWith(ProtocolInvalidRequest({}), 400);
    const decodedBody = deserialize(body, { maxBytes: maxRequestBytes });
    if (!decodedBody.ok) return failWith(ProtocolInvalidRequest({}), 400);
    const raw = decodedBody.value;
    const envelope = decodeRequestEnvelope(raw);
    const batch = envelope ? undefined : decodeBatchRequestEnvelope(raw);
    if (!envelope && !batch) return failWith(ProtocolInvalidRequest({}), 400);
    if (batch && batch.batch.length > maxBatchItems) {
      return failWith(ProtocolInvalidRequest({}), 400);
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
      return failWith(
        ServerInternal({ incidentId }),
        ServerInternal.policy.httpStatus ?? 500,
        envelope?.path,
      );
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
          return failWith(
            ServerInternal({ incidentId }),
            ServerInternal.policy.httpStatus ?? 500,
            envelope.path,
          );
        }
        if (!decodedInput.ok)
          return failWith(badRequestFromIssues(decodedInput.issues), 400, envelope.path);
        return streamProcedureResponse(
          subscription,
          decodedInput.value,
          context,
          envelope.path,
          request.signal,
          // Only a declared resumable subscription may see a resume point; an
          // undeclared one must not be handed client-supplied state it never
          // asked for.
          subscription._def.resumable === undefined ? undefined : envelope.lastEventId,
          options.onInternalError,
          (failure, status) => notify(failure, status, envelope.path),
        );
      }
    }

    const dispatch = async (item: { readonly path: string; readonly input: unknown }) => {
      const procedure = options.router.procedures.get(item.path);
      if (!procedure) return failWith(ProtocolNotFound({}), 404, item.path);
      if (procedure._kind === "subscription-procedure") {
        return failWith(ProtocolInvalidRequest({}), 400, item.path);
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
        return failWith(
          ServerInternal({ incidentId }),
          ServerInternal.policy.httpStatus ?? 500,
          item.path,
        );
      }
      if (!decodedInput.ok)
        return failWith(badRequestFromIssues(decodedInput.issues), 400, item.path);
      const touched: string[] = [];
      const result = await executeProcedure(procedure, decodedInput.value, {
        context,
        procedurePath: item.path,
        signal: request.signal,
        responseHeaders,
        onTouch: (key) => void touched.push(key),
        ...(options.onInternalError === undefined
          ? {}
          : { onInternalError: options.onInternalError }),
      });
      try {
        return encodeProcedureResult(
          procedure,
          result,
          (failure, status, failureTouched) =>
            finalizeFailure(failure, status, item.path, failureTouched),
          touched,
        );
      } catch (cause) {
        const incidentId = `inc_${crypto.randomUUID()}`;
        options.onInternalError?.({
          incidentId,
          phase: "output",
          cause,
          procedurePath: item.path,
        });
        return failWith(
          ServerInternal({ incidentId }),
          ServerInternal.policy.httpStatus ?? 500,
          item.path,
        );
      }
    };

    if (envelope) return dispatch(envelope);

    const items = await Promise.all(
      batch!.batch.map(async (item) => {
        const response = await dispatch(item);
        const decoded = deserialize(await response.text(), { maxBytes: DEFAULT_MAX_WIRE_BYTES });
        if (!decoded.ok) throw new TypeError("Unable to decode an internal batch item");
        const responseEnvelope = decodeResponseEnvelope(decoded.value);
        if (!responseEnvelope) throw new TypeError("Invalid internal batch response envelope");
        return {
          id: item.id,
          status: response.status,
          response: responseEnvelope,
        };
      }),
    );
    return wireResponse({ v: PROTOCOL_VERSION, batch: items }, 200);
  };
  return async (request) => {
    // One Headers per request: handlers append through the context, and every
    // response shape — unary, batched, streaming — passes through here.
    const responseHeaders = new Headers();
    let response: Response;
    try {
      response = await handle(request, responseHeaders);
    } catch (cause) {
      // The caller leaving is transport control flow. Let the fetch boundary
      // observe its own aborted signal and translate it to `cancelled`; an
      // incident response has no remaining consumer and would misclassify the
      // handler's AbortError as an application defect.
      if (request.signal.aborted) throw cause;
      const incidentId = `inc_${crypto.randomUUID()}`;
      options.onInternalError?.({ incidentId, phase: "output", cause });
      const failure = ServerInternal({ incidentId });
      response = finalizeFailure(failure, ServerInternal.policy.httpStatus ?? 500);
    }
    for (const [name, value] of responseHeaders) {
      // `append`, not `set`: several procedures in one batch may each add a
      // `set-cookie`, and those must not overwrite one another.
      response.headers.append(name, value);
    }
    response.headers.set(CONTRACT_HEADER, contractVersion);
    return response;
  };
};

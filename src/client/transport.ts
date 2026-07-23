import {
  PROTOCOL_CONTENT_TYPE,
  PROTOCOL_VERSION,
  decodeBatchResponseEnvelope,
  isProtocolContentType,
  type BatchRequestEnvelope,
  type RequestEnvelope,
} from "../protocol.js";
import { DEFAULT_MAX_WIRE_BYTES, deserialize, serialize } from "../serializer.js";

export const cancelled = Object.freeze({
  _tag: "control/cancelled" as const,
  data: Object.freeze({}),
});

export const isCancelled = (value: unknown): value is typeof cancelled =>
  value !== null
  && typeof value === "object"
  && "_tag" in value
  && value._tag === "control/cancelled";

export interface TransportResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

export interface TransportStreamResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: ReadableStream<Uint8Array> | null;
}

export type TransportOutcome =
  | Readonly<{ ok: true; response: TransportResponse }>
  | Readonly<{ ok: false; reason: "offline" }>
  | Readonly<{ ok: false; reason: "network" }>
  | Readonly<{ ok: false; reason: "timeout"; timeoutMs: number }>;

export type TransportStreamOutcome =
  | Readonly<{ ok: true; response: TransportStreamResponse }>
  | Exclude<TransportOutcome, { ok: true }>;

export interface TransportRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Direct-client operation retry. Query/subscription runtimes leave this unset. */
  readonly retry?: false | "from-error-policy";
}

export interface ClientTransport {
  request(
    envelope: RequestEnvelope,
    options?: TransportRequestOptions,
    /** Sidecar file parts referenced by markers inside the envelope input. */
    files?: readonly Blob[],
  ): Promise<TransportOutcome>;
  stream?(
    envelope: RequestEnvelope,
    options?: TransportRequestOptions,
  ): Promise<TransportStreamOutcome>;
}

export interface FetchTransportOptions {
  readonly url: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface BatchFetchTransportOptions extends FetchTransportOptions {
  readonly maxItems?: number;
}

const browserIsOffline = (): boolean =>
  typeof navigator !== "undefined" && navigator.onLine === false;

const readResponseBody = async (
  response: Response,
  maxBytes: number,
): Promise<string | undefined> => {
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
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
};

export const fetchTransport = (options: FetchTransportOptions): ClientTransport => ({
  request: async (envelope, requestOptions = {}, files) => {
    const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs ?? 30_000;
    if (requestOptions.signal?.aborted) throw cancelled;

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = requestOptions.signal
      ? AbortSignal.any([requestOptions.signal, timeoutController.signal])
      : timeoutController.signal;

    const encoded = serialize(envelope, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
    if (!encoded.ok) {
      clearTimeout(timeout);
      throw new TypeError("Request envelope is not serializable");
    }

    // Files ride as multipart sidecar parts; the envelope stays devalue.
    let requestBody: string | FormData = encoded.value;
    let headers: Record<string, string> = {
      ...options.headers,
      "content-type": PROTOCOL_CONTENT_TYPE,
    };
    if (files && files.length > 0) {
      const form = new FormData();
      form.set("envelope", encoded.value);
      files.forEach((part, index) => form.set(String(index), part));
      requestBody = form;
      // fetch sets the multipart boundary itself
      headers = { ...options.headers };
    }

    try {
      const response = await (options.fetch ?? globalThis.fetch)(options.url, {
        method: "POST",
        headers,
        body: requestBody,
        signal,
      });
      const body = await readResponseBody(
        response,
        options.maxResponseBytes ?? DEFAULT_MAX_WIRE_BYTES,
      );
      if (body === undefined) {
        return {
          ok: true,
          response: {
            status: response.status,
            contentType: response.headers.get("content-type"),
            body: "response exceeded byte limit",
          },
        };
      }
      return {
        ok: true,
        response: {
          status: response.status,
          contentType: response.headers.get("content-type"),
          body,
        },
      };
    } catch {
      if (requestOptions.signal?.aborted) throw cancelled;
      if (timeoutController.signal.aborted) {
        return { ok: false, reason: "timeout", timeoutMs };
      }
      if (browserIsOffline()) return { ok: false, reason: "offline" };
      return { ok: false, reason: "network" };
    } finally {
      clearTimeout(timeout);
    }
  },
  stream: async (envelope, requestOptions = {}) => {
    const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs ?? 30_000;
    if (requestOptions.signal?.aborted) throw cancelled;
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = requestOptions.signal
      ? AbortSignal.any([requestOptions.signal, timeoutController.signal])
      : timeoutController.signal;
    const encoded = serialize(envelope, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
    if (!encoded.ok) throw new TypeError("Request envelope is not serializable");
    try {
      const response = await (options.fetch ?? globalThis.fetch)(options.url, {
        method: "POST",
        headers: { ...options.headers, "content-type": PROTOCOL_CONTENT_TYPE },
        body: encoded.value,
        signal,
      });
      clearTimeout(timeout);
      return {
        ok: true,
        response: {
          status: response.status,
          contentType: response.headers.get("content-type"),
          body: response.body,
        },
      };
    } catch {
      clearTimeout(timeout);
      if (requestOptions.signal?.aborted) throw cancelled;
      if (timeoutController.signal.aborted) {
        return { ok: false, reason: "timeout", timeoutMs };
      }
      if (browserIsOffline()) return { ok: false, reason: "offline" };
      return { ok: false, reason: "network" };
    }
  },
});

interface PendingBatchItem {
  readonly envelope: RequestEnvelope;
  readonly options: TransportRequestOptions;
  readonly resolve: (outcome: TransportOutcome) => void;
  readonly reject: (reason: unknown) => void;
}

/** Coalesces calls made in the same microtask into one HTTP request. */
export const batchFetchTransport = (
  options: BatchFetchTransportOptions,
): ClientTransport => {
  const maxItems = options.maxItems ?? 20;
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) {
    throw new TypeError("maxItems must be a positive integer");
  }
  let queue: PendingBatchItem[] = [];
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
    const envelope: BatchRequestEnvelope = {
      v: PROTOCOL_VERSION,
      batch: active.map((item, index) => ({ ...item.envelope, id: ids[index]! })),
    };
    const encoded = serialize(envelope, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
    if (!encoded.ok) {
      for (const item of active) item.reject(new TypeError("Batch is not serializable"));
      return;
    }

    const timeoutMs = Math.min(...active.map(
      (item) => item.options.timeoutMs ?? options.timeoutMs ?? 30_000,
    ));
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);
    const abortListeners: Array<readonly [AbortSignal, () => void]> = [];
    const abortWhenDetached = () => {
      if (active.every((item) => item.options.signal?.aborted === true)) {
        timeoutController.abort();
      }
    };
    for (const item of active) {
      if (!item.options.signal) continue;
      item.options.signal.addEventListener("abort", abortWhenDetached, { once: true });
      abortListeners.push([item.options.signal, abortWhenDetached]);
    }
    try {
      const response = await (options.fetch ?? globalThis.fetch)(options.url, {
        method: "POST",
        headers: { ...options.headers, "content-type": PROTOCOL_CONTENT_TYPE },
        body: encoded.value,
        signal: timeoutController.signal,
      });
      const body = await readResponseBody(
        response,
        options.maxResponseBytes ?? DEFAULT_MAX_WIRE_BYTES,
      );
      if (body === undefined) {
        const outcome: TransportOutcome = {
          ok: true,
          response: {
            status: response.status,
            contentType: response.headers.get("content-type"),
            body: "response exceeded byte limit",
          },
        };
        for (const item of active) item.resolve(outcome);
        return;
      }
      const contentType = response.headers.get("content-type");
      const decoded = isProtocolContentType(contentType)
        ? deserialize(body, { maxBytes: DEFAULT_MAX_WIRE_BYTES })
        : undefined;
      const batch = decoded?.ok ? decodeBatchResponseEnvelope(decoded.value) : undefined;
      if (!batch) {
        const outcome: TransportOutcome = {
          ok: true,
          response: { status: response.status, contentType, body },
        };
        for (const item of active) {
          if (item.options.signal?.aborted) item.reject(cancelled);
          else item.resolve(outcome);
        }
        return;
      }
      const byId = new Map(batch.batch.map((item) => [item.id, item] as const));
      active.forEach((item, index) => {
        if (item.options.signal?.aborted) return item.reject(cancelled);
        const result = byId.get(ids[index]!);
        if (!result) {
          return item.resolve({
            ok: true,
            response: { status: 200, contentType, body: "invalid batch response" },
          });
        }
        const itemBody = serialize(result.response, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
        if (!itemBody.ok) return item.reject(new TypeError("Batch item is not serializable"));
        item.resolve({
          ok: true,
          response: {
            status: result.status,
            contentType: PROTOCOL_CONTENT_TYPE,
            body: itemBody.value,
          },
        });
      });
    } catch {
      const outcome: TransportOutcome = timedOut
        ? { ok: false, reason: "timeout", timeoutMs }
        : browserIsOffline()
          ? { ok: false, reason: "offline" }
          : { ok: false, reason: "network" };
      for (const item of active) {
        if (item.options.signal?.aborted) item.reject(cancelled);
        else item.resolve(outcome);
      }
    } finally {
      clearTimeout(timeout);
      for (const [signal, listener] of abortListeners) {
        signal.removeEventListener("abort", listener);
      }
    }
  };

  const streaming = fetchTransport(options);
  return {
    request: (envelope, requestOptions = {}, files) => new Promise((resolve, reject) => {
      if (requestOptions.signal?.aborted) return reject(cancelled);
      if (files && files.length > 0) {
        // uploads never batch: one multipart request per call
        streaming.request(envelope, requestOptions, files).then(resolve, reject);
        return;
      }
      queue.push({ envelope, options: requestOptions, resolve, reject });
      if (queue.length >= maxItems) void flush();
      else if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    }),
    stream: streaming.stream!,
  };
};

export const requestEnvelope = (
  path: string,
  input: RequestEnvelope["input"],
): RequestEnvelope => ({ v: PROTOCOL_VERSION, path, input });

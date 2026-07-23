import { describe, expect, test } from "bun:test";
import { err, error, ok, serialize, wire } from "../index.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { createClient, type ClientEvent } from "./client.js";
import {
  batchFetchTransport,
  cancelled,
  fetchTransport,
  type ClientTransport,
} from "./transport.js";

interface Context {
  readonly values: ReadonlyMap<string, string>;
}

const NotFound = error({
  tag: "value/not-found",
  data: wire.object({ id: wire.string }),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
});

const Expired = error({
  tag: "value/expired",
  data: wire.object({ at: wire.date, sequence: wire.bigint }),
  httpStatus: 410,
  retry: "never",
  visibility: "public",
});

const r = rpc.context<Context>();
const byId = r
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.object({ id: wire.string, value: wire.string }))
  .errors({ NotFound })
  .query(({ input, context, errors }) => {
    const value = context.values.get(input.id);
    return value === undefined
      ? err(errors.NotFound({ id: input.id }))
      : ok({ id: input.id, value });
  });

const broken = r
  .procedure()
  .input(wire.object({}))
  .output(wire.string)
  .query(() => {
    throw new Error("secret server detail");
  });

const rich = r
  .procedure()
  .input(wire.object({ fail: wire.boolean }))
  .output(wire.object({
    at: wire.date,
    sequence: wire.bigint,
    missing: wire.undefined,
    pattern: wire.regexp,
    url: wire.url,
  }))
  .errors({ Expired })
  .query(({ input, errors }) => input.fail
    ? err(errors.Expired({ at: new Date("2026-01-01T00:00:00.000Z"), sequence: 9n }))
    : ok({
        at: new Date("2026-01-01T00:00:00.000Z"),
        sequence: 9n,
        missing: undefined,
        pattern: /trip/giu,
        url: new URL("https://example.test/trip"),
      }));

const eventsContract = r
  .procedure()
  .input(wire.object({ fail: wire.boolean }))
  .output(wire.object({ at: wire.date, sequence: wire.bigint }))
  .errors({ Expired })
  .subscription();
const events = r.implement(eventsContract).stream(async function* ({ input, errors }) {
  yield ok({ at: new Date("2026-01-01T00:00:00.000Z"), sequence: 1n });
  if (input.fail) {
    yield err(errors.Expired({
      at: new Date("2026-01-02T00:00:00.000Z"),
      sequence: 2n,
    }));
    return;
  }
  yield ok({ at: new Date("2026-01-03T00:00:00.000Z"), sequence: 3n });
});

const router = r.router({ value: { byId, broken, rich, events } });

const handler = createFetchHandler({
  router,
  createContext: () => ({ values: new Map([["one", "first"]]) }),
});

const localFetch = (async (input: string | URL | Request, init?: RequestInit) =>
  handler(new Request(input, init))) as typeof globalThis.fetch;

const client = createClient({
  router,
  transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
});

describe("unary client and server", () => {
  test("uses a browser-safe contract without retaining server handlers", async () => {
    const contractProcedure = r
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ NotFound })
      .query();
    const contract = r.contract({ shared: { byId: contractProcedure } });
    const implementation = r.implement(contractProcedure).handler(({ input, errors }) =>
      input.id === "one" ? ok("first") : err(errors.NotFound({ id: input.id })));
    const contractHandler = createFetchHandler({
      router: r.router({ shared: { byId: implementation } }),
      createContext: () => ({ values: new Map() }),
    });
    const contractClient = createClient({
      contract,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          contractHandler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });

    expect("handler" in contractProcedure._def).toBe(false);
    expect(await contractClient.shared.byId({ id: "one" })).toEqual(ok("first"));
    expect(await contractClient.shared.byId({ id: "missing" }))
      .toEqual(err(NotFound({ id: "missing" })));
  });

  test("round trips a successful procedure", async () => {
    const result = await client.value.byId({ id: "one" });
    expect(result).toEqual({ ok: true, value: { id: "one", value: "first" } });
  });

  test("batches concurrent calls while preserving per-item results", async () => {
    let requests = 0;
    const batched = createClient({
      router,
      transport: batchFetchTransport({
        url: "https://example.test/rpc",
        fetch: (async (input: string | URL | Request, init?: RequestInit) => {
          requests += 1;
          return localFetch(input, init);
        }) as typeof globalThis.fetch,
      }),
    });

    const [found, missing] = await Promise.all([
      batched.value.byId({ id: "one" }),
      batched.value.byId({ id: "missing" }),
    ]);
    expect(requests).toBe(1);
    expect(found).toEqual(ok({ id: "one", value: "first" }));
    expect(missing).toEqual(err(NotFound({ id: "missing" })));
  });

  test("rejects batches above the server item limit", async () => {
    const limitedHandler = createFetchHandler({
      router,
      maxBatchItems: 1,
      createContext: () => ({ values: new Map([["one", "first"]]) }),
    });
    const batched = createClient({
      router,
      transport: batchFetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          limitedHandler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const results = await Promise.all([
      batched.value.byId({ id: "one" }),
      batched.value.byId({ id: "missing" }),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error._tag).toBe("client/protocol-violation");
    }
  });

  test("aborts a shared batch only after every item is cancelled", async () => {
    let sharedAborted = false;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const batched = createClient({
      router,
      transport: batchFetchTransport({
        url: "https://example.test/rpc",
        fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
          markStarted?.();
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener("abort", () => {
              sharedAborted = true;
              reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
          });
        }) as unknown as typeof globalThis.fetch,
      }),
    });
    const first = new AbortController();
    const second = new AbortController();
    const firstCall = batched.value.byId({ id: "one" }, { signal: first.signal });
    const secondCall = batched.value.byId({ id: "one" }, { signal: second.signal });
    const firstRejected = firstCall.then(
      () => { throw new Error("first batch item unexpectedly resolved"); },
      (failure) => failure,
    );
    const secondRejected = secondCall.then(
      () => { throw new Error("second batch item unexpectedly resolved"); },
      (failure) => failure,
    );
    await started;
    first.abort();
    await Promise.resolve();
    expect(sharedAborted).toBe(false);
    second.abort();
    expect(await firstRejected).toEqual(cancelled);
    expect(await secondRejected).toEqual(cancelled);
    expect(sharedAborted).toBe(true);
  });

  test("round trips and reconstructs a declared tagged error", async () => {
    const result = await client.value.byId({ id: "missing" });
    expect(result).toEqual({ ok: false, error: NotFound({ id: "missing" }) });
    if (!result.ok) expect(NotFound.is(result.error)).toBe(true);
  });

  test("transparently round trips rich success and error values", async () => {
    const success = await client.value.rich({ fail: false });
    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.value.at).toBeInstanceOf(Date);
      expect(success.value.sequence).toBe(9n);
      expect("missing" in success.value).toBe(true);
      expect(success.value.missing).toBeUndefined();
      expect(success.value.pattern).toEqual(/trip/giu);
      expect(success.value.url).toEqual(new URL("https://example.test/trip"));
    }

    const failure = await client.value.rich({ fail: true });
    expect(failure.ok).toBe(false);
    if (!failure.ok && failure.error._tag === "value/expired") {
      expect(failure.error.data.at).toBeInstanceOf(Date);
      expect(failure.error.data.sequence).toBe(9n);
    }
  });

  test("streams rich values and a terminal declared tagged error", async () => {
    const received = [];
    for await (const result of client.value.events({ fail: true })) received.push(result);

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(ok({
      at: new Date("2026-01-01T00:00:00.000Z"),
      sequence: 1n,
    }));
    expect(received[1]).toEqual(err(Expired({
      at: new Date("2026-01-02T00:00:00.000Z"),
      sequence: 2n,
    })));
  });

  test("sanitizes an unknown server exception", async () => {
    const result = await client.value.broken({});
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
    if (!result.ok) expect(result.error._tag).toBe("server/internal");
  });

  test("maps an intermediary HTML 502 to an HTTP failure", async () => {
    const intermediary = createClient({
      router,
      transport: {
        request: async () => ({
          ok: true,
          response: { status: 502, contentType: "text/html", body: "bad gateway" },
        }),
      },
    });
    const result = await intermediary.value.byId({ id: "one" });
    expect(result).toEqual({
      ok: false,
      error: { _tag: "client/http-failure", data: { status: 502 } },
    });
  });

  test("rejects unknown tags, malformed known errors, and protocol versions", async () => {
    const cases = [
      {
        envelope: { v: 1, ok: false, error: { _tag: "hostile/unknown", data: {} } },
        tag: "client/protocol-violation",
      },
      {
        envelope: { v: 1, ok: false, error: { _tag: "value/not-found", data: { id: 1 } } },
        tag: "client/decode-failure",
      },
      {
        envelope: { v: 2, ok: true, value: { id: "one", value: "first" } },
        tag: "client/protocol-violation",
      },
    ] as const;
    for (const testCase of cases) {
      const encoded = serialize(testCase.envelope);
      if (!encoded.ok) throw new Error("test envelope did not serialize");
      const hostile = createClient({
        router,
        transport: {
          request: async () => ({
            ok: true,
            response: {
              status: testCase.envelope.ok === false ? 404 : 200,
              contentType: "application/result-rpc+devalue; sv=1",
              body: encoded.value,
            },
          }),
        },
      });
      const result = await hostile.value.byId({ id: "one" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error._tag).toBe(testCase.tag);
    }
  });

  test("maps transport outcomes into the operation error union", async () => {
    const transport: ClientTransport = {
      request: async () => ({ ok: false, reason: "timeout", timeoutMs: 50 }),
    };
    const timed = createClient({ router, transport });
    const result = await timed.value.byId({ id: "one" });
    expect(result).toEqual({
      ok: false,
      error: { _tag: "client/timeout", data: { timeoutMs: 50 } },
    });
  });

  test("classifies a library-owned fetch timeout", async () => {
    const timed = createClient({
      router,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        timeoutMs: 1,
        fetch: (async (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
          })) as unknown as typeof globalThis.fetch,
      }),
    });
    const result = await timed.value.byId({ id: "one" });
    expect(result).toEqual({
      ok: false,
      error: { _tag: "client/timeout", data: { timeoutMs: 1 } },
    });
  });

  test("direct calls can opt into the tagged retry policy", async () => {
    let attempts = 0;
    const local = fetchTransport({ url: "https://example.test/rpc", fetch: localFetch });
    const retrying = createClient({
      router,
      transport: {
        request: (...args) => {
          attempts += 1;
          return attempts < 2
            ? Promise.resolve({ ok: false as const, reason: "network" as const })
            : local.request(...args);
        },
      },
    });
    const result = await retrying.value.byId(
      { id: "one" },
      { retry: "from-error-policy" },
    );
    expect(result).toEqual(ok({ id: "one", value: "first" }));
    expect(attempts).toBe(2);
  });

  test("validates client inputs before transport", async () => {
    let called = false;
    const invalid = createClient({
      router,
      transport: { request: async () => {
        called = true;
        return { ok: false, reason: "network" };
      } },
    });
    await expect(invalid.value.byId({ id: 123 } as never)).rejects.toThrow("Invalid input");
    expect(called).toBe(false);
  });

  test("bounds response bodies before decoding them", async () => {
    const bounded = createClient({
      router,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        maxResponseBytes: 32,
        fetch: (async () => new Response("x".repeat(1_000), {
          status: 200,
          headers: { "content-type": "application/result-rpc+devalue; sv=1" },
        })) as unknown as typeof globalThis.fetch,
      }),
    });
    const result = await bounded.value.byId({ id: "one" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("client/protocol-violation");
  });
});

describe("observability events", () => {
  const NotFound = error({ tag: "obs/not-found", httpStatus: "not-found" });
  const Flaky = error({ tag: "obs/flaky", httpStatus: "service-unavailable", retry: "transient" });

  const makeObservedClient = () => {
    const r = rpc.context<{}>();
    let failures = 0;
    const router = r.router({
      find: r.procedure()
        .input(wire.object({ id: wire.string }))
        .output(wire.string)
        .errors({ NotFound })
        .query(({ input, errors }) =>
          input.id === "missing" ? err(errors.NotFound()) : ok(input.id)),
      flaky: r.procedure()
        .output(wire.string)
        .errors({ Flaky })
        .query(({ errors }) => (failures++ < 1 ? err(errors.Flaky()) : ok("recovered"))),
    });
    const handler = createFetchHandler({ router, createContext: () => ({}) });
    const localFetch = ((input: string | URL | Request, init?: RequestInit) =>
      handler(new Request(input, init))) as typeof globalThis.fetch;
    const events: ClientEvent[] = [];
    const client = createClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
      onEvent: (event) => events.push(event),
    });
    return { client, events };
  };

  test("calls emit call/success and call/failure breadcrumbs with timing", async () => {
    const { client, events } = makeObservedClient();
    await client.find({ id: "one" });
    await client.find({ id: "missing" });
    expect(events.map((e) => e.type)).toEqual(["call", "success", "call", "failure"]);
    const failure = events[3] as Extract<ClientEvent, { type: "failure" }>;
    expect(failure.path).toBe("find");
    expect(failure.tag).toBe("obs/not-found");
    expect(failure.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("policy-driven retries appear in the stream", async () => {
    const { client, events } = makeObservedClient();
    const result = await client.flaky(undefined, { retry: "from-error-policy" });
    expect(result).toEqual(ok("recovered"));
    expect(events.map((e) => e.type)).toEqual(["call", "retry", "success"]);
    const retry = events[1] as Extract<ClientEvent, { type: "retry" }>;
    expect(retry.tag).toBe("obs/flaky");
    expect(retry.attempt).toBe(1);
  });

  test("the stream adapts to a Sentry-shaped sink in one function", async () => {
    const breadcrumbs: { category: string; message: string; level: string; data: unknown }[] = [];
    const fakeSentry = { addBreadcrumb: (crumb: (typeof breadcrumbs)[number]) => breadcrumbs.push(crumb) };
    const r = rpc.context<{}>();
    const router = r.router({
      ping: r.procedure().output(wire.string).query(() => ok("pong")),
    });
    const handler = createFetchHandler({ router, createContext: () => ({}) });
    const client = createClient({
      router,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler(new Request(input, init))) as typeof globalThis.fetch,
      }),
      onEvent: (event) => fakeSentry.addBreadcrumb({
        category: `rpc.${event.type}`,
        message: event.path,
        level: event.type === "failure" ? "warning" : "info",
        data: event,
      }),
    });
    await client.ping();
    expect(breadcrumbs.map((crumb) => crumb.category)).toEqual(["rpc.call", "rpc.success"]);
  });
});

describe("file uploads", () => {
  const makeUploadWorld = (transportKind: "fetch" | "batch") => {
    const r = rpc.context<{}>();
    const router = r.router({
      avatar: r.procedure()
        .input(wire.object({
          userId: wire.string,
          image: wire.file({ maxBytes: 1024, accept: ["image/*"] }),
        }))
        .output(wire.object({ name: wire.string, bytes: wire.number, preview: wire.string }))
        .mutation(async ({ input }) => {
          const text = await input.image.text();
          return ok({
            name: input.image.name,
            bytes: input.image.size,
            preview: `${input.userId}:${text.slice(0, 8)}`,
          });
        }),
      ping: r.procedure().output(wire.string).query(() => ok("pong")),
    });
    const handler = createFetchHandler({ router, createContext: () => ({}) });
    const localFetch = ((input: string | URL | Request, init?: RequestInit) =>
      handler(new Request(input, init))) as typeof globalThis.fetch;
    const transport = transportKind === "fetch"
      ? fetchTransport({ url: "https://example.test/rpc", fetch: localFetch })
      : batchFetchTransport({ url: "https://example.test/rpc", fetch: localFetch });
    return { client: createClient({ router, transport }), handler };
  };

  test("a typed File field rides the wire and arrives as a real File", async () => {
    const { client } = makeUploadWorld("fetch");
    const image = new File(["png-data-here"], "me.png", { type: "image/png" });
    const result = await client.avatar({ userId: "u_1", image });
    expect(result).toEqual(ok({ name: "me.png", bytes: 13, preview: "u_1:png-data" }));
  });

  test("uploads bypass batching; plain calls still batch alongside", async () => {
    const { client } = makeUploadWorld("batch");
    const image = new File(["x"], "tiny.gif", { type: "image/gif" });
    const [uploaded, ponged] = await Promise.all([
      client.avatar({ userId: "u_2", image }),
      client.ping(),
    ]);
    expect(uploaded.ok).toBe(true);
    expect(ponged).toEqual(ok("pong"));
  });

  test("file constraints reject at the client boundary before any bytes move", async () => {
    const { client } = makeUploadWorld("fetch");
    const huge = new File(["x".repeat(2048)], "big.png", { type: "image/png" });
    await expect(client.avatar({ userId: "u_3", image: huge }))
      .rejects.toThrow(/exceeds 1024 bytes/);
    const wrongType = new File(["hi"], "notes.txt", { type: "text/plain" });
    await expect(client.avatar({ userId: "u_3", image: wrongType }))
      .rejects.toThrow(/Unsupported file type/);
  });

  test("a smuggled marker in a plain request never resolves to a file", async () => {
    const { handler } = makeUploadWorld("fetch");
    const envelope = serialize({
      v: 1,
      path: "avatar",
      input: { userId: "u_4", image: { $resultRpcFile: 0 } },
    });
    if (!envelope.ok) throw new Error("unreachable");
    const response = await handler(new Request("https://example.test/rpc", {
      method: "POST",
      headers: { "content-type": "application/result-rpc+devalue; sv=1" },
      body: envelope.value,
    }));
    // no multipart parts: the marker stays a plain object and fails validation
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("server/bad-request");
  });
});

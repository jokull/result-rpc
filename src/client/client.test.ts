import { PROTOCOL_CONTENT_TYPE, PROTOCOL_VERSION, STREAM_CONTENT_TYPE } from "../protocol.js";
import { describe, expect, test } from "bun:test";
import { err, error, gen, isTaggedError, ok, serialize, wire } from "../index.js";
import { ClientHttpFailure, ClientTimeout } from "../framework-errors.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { createFixtureClient } from "../testing/index.js";
import { getProcedureClientMetadata, type ClientEvent } from "./client.js";
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
  .output(
    wire.object({
      at: wire.date,
      sequence: wire.bigint,
      missing: wire.undefined,
      pattern: wire.regexp,
      url: wire.url,
    }),
  )
  .errors({ Expired })
  .query(({ input, errors }) =>
    input.fail
      ? err(errors.Expired({ at: new Date("2026-01-01T00:00:00.000Z"), sequence: 9n }))
      : ok({
          at: new Date("2026-01-01T00:00:00.000Z"),
          sequence: 9n,
          missing: undefined,
          pattern: /trip/giu,
          url: new URL("https://example.test/trip"),
        }),
  );

const eventsContract = r
  .procedure()
  .input(wire.object({ fail: wire.boolean }))
  .output(wire.object({ at: wire.date, sequence: wire.bigint }))
  .errors({ Expired })
  .subscription();
const events = r.implement(eventsContract).stream(async function* ({ input, errors }) {
  yield ok({ at: new Date("2026-01-01T00:00:00.000Z"), sequence: 1n });
  if (input.fail) {
    yield err(
      errors.Expired({
        at: new Date("2026-01-02T00:00:00.000Z"),
        sequence: 2n,
      }),
    );
    return;
  }
  yield ok({ at: new Date("2026-01-03T00:00:00.000Z"), sequence: 3n });
});

const acceptNull = r
  .procedure()
  .input(wire.null)
  .output(wire.null)
  .query(({ input }) => ok(input));
const acceptUndefined = r
  .procedure()
  .input(wire.undefined)
  .output(wire.undefined)
  .query(({ input }) => ok(input));

const router = r.router({
  value: { byId, broken, rich, events, acceptNull, acceptUndefined },
});

const handler = createFetchHandler({
  router,
  createContext: () => ({ values: new Map([["one", "first"]]) }),
});

const localFetch = (async (input: string | URL | Request, init?: RequestInit) =>
  handler(new Request(input, init))) as typeof globalThis.fetch;

const client = createFixtureClient({
  router,
  transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
});

describe("unary client and server", () => {
  test("preserves explicit null and undefined inputs across the wire", async () => {
    expect(await client.value.acceptNull(null)).toEqual(ok(null));
    expect(await client.value.acceptUndefined(undefined)).toEqual(ok(undefined));
  });

  test("exposes the app-wide public error registry", () => {
    const missing = NotFound({ id: "missing" });
    const privateFailure = error({
      tag: "db/private",
      data: wire.object({ detail: wire.string }),
      visibility: "private",
    })({ detail: "constraint detail" });

    expect(missing.visibility).toBe("public");
    expect(client.$errors.definitions.get(NotFound.tag)).toBe(NotFound);
    expect(client.$errors.is(missing)).toBe(true);
    expect(client.$errors.is(privateFailure)).toBe(false);
  });

  test("retains an exact runtime error registry per procedure callable", () => {
    const metadata = getProcedureClientMetadata(client.value.byId);
    expect(metadata).toBeDefined();
    expect(metadata!.errors.is(NotFound({ id: "missing" }))).toBe(true);
    expect(metadata!.errors.is(ClientTimeout({ timeoutMs: 50 }))).toBe(true);
    expect(metadata!.errors.is(Expired({ at: new Date(), sequence: 1n }))).toBe(false);
    expect(metadata!.errors.definitions.has(Expired.tag)).toBe(false);
  });

  test("uses a browser-safe contract without retaining server handlers", async () => {
    const contractProcedure = r
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ NotFound })
      .query();
    const contract = r.contract({ shared: { byId: contractProcedure } });
    const implementation = r
      .implement(contractProcedure)
      .handler(({ input, errors }) =>
        input.id === "one" ? ok("first") : err(errors.NotFound({ id: input.id })),
      );
    const contractHandler = createFetchHandler({
      router: r.router({ shared: { byId: implementation } }),
      createContext: () => ({ values: new Map() }),
    });
    const contractClient = createFixtureClient({
      contract,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          contractHandler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });

    expect("handler" in contractProcedure._def).toBe(false);
    expect(await contractClient.shared.byId({ id: "one" })).toEqual(ok("first"));
    expect(await contractClient.shared.byId({ id: "missing" })).toEqual(
      err(NotFound({ id: "missing" })),
    );
  });

  test("round trips a successful procedure", async () => {
    const result = await client.value.byId({ id: "one" });
    expect(result).toEqual(ok({ id: "one", value: "first" }));
  });

  test("batches concurrent calls while preserving per-item results", async () => {
    let requests = 0;
    const batched = createFixtureClient({
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
    const batched = createFixtureClient({
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
      expect(result.isOk()).toBe(false);
      if (!result.isOk()) expect(result.error._tag).toBe("client/protocol-violation");
    }
  });

  test("aborts a shared batch only after every item is cancelled", async () => {
    let sharedAborted = false;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const batched = createFixtureClient({
      router,
      transport: batchFetchTransport({
        url: "https://example.test/rpc",
        fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
          markStarted?.();
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener(
              "abort",
              () => {
                sharedAborted = true;
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          });
        }) as unknown as typeof globalThis.fetch,
      }),
    });
    const first = new AbortController();
    const second = new AbortController();
    const firstCall = batched.value.byId({ id: "one" }, { signal: first.signal });
    const secondCall = batched.value.byId({ id: "one" }, { signal: second.signal });
    const firstRejected = firstCall.then(
      () => {
        throw new Error("first batch item unexpectedly resolved");
      },
      (failure) => failure,
    );
    const secondRejected = secondCall.then(
      () => {
        throw new Error("second batch item unexpectedly resolved");
      },
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
    expect(result).toEqual(err(NotFound({ id: "missing" })));
    if (!result.isOk()) {
      expect(result.error).toBeInstanceOf(Error);
      expect(isTaggedError(result.error)).toBe(true);
      expect(NotFound.is(result.error)).toBe(true);
      expect(result.error.name).toBe("value/not-found");
      expect(result.error.toJSON()).toEqual({
        _tag: "value/not-found",
        data: { id: "missing" },
      });
    }
  });

  test("a Result and its TaggedError remain composable after crossing the wire", async () => {
    const outcome = await gen(async function* () {
      const value = yield* await client.value.byId({ id: "missing" });
      return ok(value.value);
    });

    expect(outcome).toEqual(err(NotFound({ id: "missing" })));
    if (!outcome.isOk()) {
      expect(NotFound.is(outcome.error)).toBe(true);
      const propagated = gen(function* () {
        return yield* outcome.error;
      });
      expect(propagated).toEqual(outcome);
    }
  });

  test("transparently round trips rich success and error values", async () => {
    const success = await client.value.rich({ fail: false });
    expect(success.isOk()).toBe(true);
    if (success.isOk()) {
      expect(success.value.at).toBeInstanceOf(Date);
      expect(success.value.sequence).toBe(9n);
      expect("missing" in success.value).toBe(true);
      expect(success.value.missing).toBeUndefined();
      expect(success.value.pattern).toEqual(/trip/giu);
      expect(success.value.url).toEqual(new URL("https://example.test/trip"));
    }

    const failure = await client.value.rich({ fail: true });
    expect(failure.isOk()).toBe(false);
    if (!failure.isOk() && failure.error._tag === "value/expired") {
      expect(failure.error.data.at).toBeInstanceOf(Date);
      expect(failure.error.data.sequence).toBe(9n);
    }
  });

  test("streams rich values and a terminal declared tagged error", async () => {
    const received = [];
    for await (const result of client.value.events({ fail: true })) received.push(result);

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(
      ok({
        at: new Date("2026-01-01T00:00:00.000Z"),
        sequence: 1n,
      }),
    );
    expect(received[1]).toEqual(
      err(
        Expired({
          at: new Date("2026-01-02T00:00:00.000Z"),
          sequence: 2n,
        }),
      ),
    );
  });

  test("sanitizes an unknown server exception", async () => {
    const result = await client.value.broken({});
    expect(result.isOk()).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
    if (!result.isOk()) expect(result.error._tag).toBe("server/internal");
  });

  test("maps an intermediary HTML 502 to an HTTP failure", async () => {
    const intermediary = createFixtureClient({
      router,
      contractVersion: "intermediary-test",
      transport: {
        request: async () => ({
          ok: true,
          response: {
            status: 502,
            contentType: "text/html",
            body: "bad gateway",
            contract: "intermediary-test",
          },
        }),
      },
    });
    const result = await intermediary.value.byId({ id: "one" });
    expect(result).toEqual(err(ClientHttpFailure({ status: 502 })));
  });

  test("rejects unknown tags, malformed known errors, and protocol versions", async () => {
    const cases = [
      {
        envelope: {
          v: PROTOCOL_VERSION,
          status: "error",
          error: { _tag: "hostile/unknown", data: {} },
        },
        tag: "client/protocol-violation",
      },
      {
        envelope: {
          v: PROTOCOL_VERSION,
          status: "error",
          error: { _tag: "value/not-found", data: { id: 1 } },
        },
        tag: "client/decode-failure",
      },
      {
        envelope: { v: 2, status: "ok", value: { id: "one", value: "first" } },
        tag: "client/protocol-violation",
      },
    ] as const;
    for (const testCase of cases) {
      const encoded = serialize(testCase.envelope);
      if (!encoded.ok) throw new Error("test envelope did not serialize");
      const hostile = createFixtureClient({
        router,
        contractVersion: "hostile-test",
        transport: {
          request: async () => ({
            ok: true,
            response: {
              status: testCase.envelope.status === "error" ? 404 : 200,
              contentType: PROTOCOL_CONTENT_TYPE,
              body: encoded.value,
              contract: "hostile-test",
            },
          }),
        },
      });
      const result = await hostile.value.byId({ id: "one" });
      expect(result.isOk()).toBe(false);
      if (!result.isOk()) expect(result.error._tag).toBe(testCase.tag);
    }
  });

  test("maps transport outcomes into the operation error union", async () => {
    const transport: ClientTransport = {
      request: async () => ({ ok: false, reason: "timeout", timeoutMs: 50 }),
    };
    const timed = createFixtureClient({ router, transport });
    const result = await timed.value.byId({ id: "one" });
    expect(result).toEqual(err(ClientTimeout({ timeoutMs: 50 })));
  });

  test("classifies a library-owned fetch timeout", async () => {
    const timed = createFixtureClient({
      router,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        timeoutMs: 1,
        fetch: (async (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          })) as unknown as typeof globalThis.fetch,
      }),
    });
    const result = await timed.value.byId({ id: "one" });
    expect(result).toEqual(err(ClientTimeout({ timeoutMs: 1 })));
  });

  test("direct calls can opt into the tagged retry policy", async () => {
    let attempts = 0;
    const local = fetchTransport({ url: "https://example.test/rpc", fetch: localFetch });
    const retrying = createFixtureClient({
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
    const result = await retrying.value.byId({ id: "one" }, { retry: "from-error-policy" });
    expect(result).toEqual(ok({ id: "one", value: "first" }));
    expect(attempts).toBe(2);
  });

  test("validates client inputs before transport", async () => {
    let called = false;
    const invalid = createFixtureClient({
      router,
      transport: {
        request: async () => {
          called = true;
          return { ok: false, reason: "network" };
        },
      },
    });
    await expect(invalid.value.byId({ id: 123 } as never)).rejects.toThrow("Invalid input");
    expect(called).toBe(false);
  });

  test("bounds response bodies before decoding them", async () => {
    const bounded = createFixtureClient({
      router,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        maxResponseBytes: 32,
        fetch: (async () =>
          new Response("x".repeat(1_000), {
            status: 200,
            headers: { "content-type": PROTOCOL_CONTENT_TYPE },
          })) as unknown as typeof globalThis.fetch,
      }),
    });
    const result = await bounded.value.byId({ id: "one" });
    expect(result.isOk()).toBe(false);
    if (!result.isOk()) expect(result.error._tag).toBe("client/protocol-violation");
  });

  test("the proxy is inert under introspection: only router paths mint nodes", () => {
    const client = createFixtureClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
    });
    const probe = client as unknown as Record<string, unknown>;
    // Dev tooling (react-test-renderer prop logging, console.log, JSON views)
    // walks these — none of them may mint a callable that throws later.
    expect(probe.valueOf).toBeUndefined();
    expect(probe.toJSON).toBeUndefined();
    expect(probe.then).toBeUndefined();
    const procedure = client.value.byId as unknown as Record<string, unknown>;
    expect(procedure.name).toBeUndefined();
    expect(procedure.valueOf).toBeUndefined();
    expect((procedure as { $kind?: string }).$kind).toBe("query");
    expect(() => JSON.stringify(client)).not.toThrow();
  });
});

describe("observability events", () => {
  const NotFound = error({ tag: "obs/not-found", httpStatus: "not-found" });
  const Flaky = error({ tag: "obs/flaky", httpStatus: "service-unavailable", retry: "transient" });

  const makeObservedClient = () => {
    const r = rpc.context<{}>();
    let failures = 0;
    const deniedEventsContract = r
      .procedure()
      .output(wire.string)
      .errors({ NotFound })
      .subscription();
    const deniedEvents = r.implement(deniedEventsContract).stream(async function* ({ errors }) {
      yield err(errors.NotFound());
    });
    const router = r.router({
      find: r
        .procedure()
        .input(wire.object({ id: wire.string }))
        .output(wire.string)
        .errors({ NotFound })
        .query(({ input, errors }) =>
          input.id === "missing" ? err(errors.NotFound()) : ok(input.id),
        ),
      flaky: r
        .procedure()
        .output(wire.string)
        .errors({ Flaky })
        .query(({ errors }) => (failures++ < 1 ? err(errors.Flaky()) : ok("recovered"))),
      deniedEvents,
    });
    const handler = createFetchHandler({ router, createContext: () => ({}) });
    const localFetch = ((input: string | URL | Request, init?: RequestInit) =>
      handler(new Request(input, init))) as typeof globalThis.fetch;
    const events: ClientEvent[] = [];
    const client = createFixtureClient({
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

  test("a claimed-style early return still observes a subscription failure", async () => {
    const { client, events } = makeObservedClient();
    const stream = client.deniedEvents({});
    const iterator = stream[Symbol.asyncIterator]();
    const terminal = await iterator.next();
    await iterator.return?.();

    expect(terminal.done).toBe(false);
    expect(!terminal.done && terminal.value.isOk()).toBe(false);
    expect(events.map((event) => event.type)).toEqual(["call", "failure"]);
    const failure = events[1] as Extract<ClientEvent, { type: "failure" }>;
    expect(failure.kind).toBe("subscription");
    expect(failure.path).toBe("deniedEvents");
    expect(failure.tag).toBe("obs/not-found");
  });

  test("the stream adapts to a Sentry-shaped sink in one function", async () => {
    const breadcrumbs: { category: string; message: string; level: string; data: unknown }[] = [];
    const fakeSentry = {
      addBreadcrumb: (crumb: (typeof breadcrumbs)[number]) => breadcrumbs.push(crumb),
    };
    const r = rpc.context<{}>();
    const router = r.router({
      ping: r
        .procedure()
        .output(wire.string)
        .query(() => ok("pong")),
    });
    const handler = createFetchHandler({ router, createContext: () => ({}) });
    const client = createFixtureClient({
      router,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler(new Request(input, init))) as typeof globalThis.fetch,
      }),
      onEvent: (event) =>
        fakeSentry.addBreadcrumb({
          category: `rpc.${event.type}`,
          message: "path" in event ? event.path : "",
          level: event.type === "failure" ? "warning" : "info",
          data: event,
        }),
    });
    await client.ping();
    expect(breadcrumbs.map((crumb) => crumb.category)).toEqual(["rpc.call", "rpc.success"]);
  });
});

describe("contract skew", () => {
  const Gone = error({ tag: "skew/gone", httpStatus: 410 });
  const makeSkewWorld = () => {
    // The deployed server is one contract ahead: byNumber's input changed
    // shape AND its error union grew — the union change flips the digest.
    const server = rpc.context<{}>();
    const serverRouter = server.router({
      byNumber: server
        .procedure()
        .input(wire.object({ id: wire.string, revision: wire.number }))
        .output(wire.string)
        .errors({ Gone })
        .query(({ input }) => ok(`${input.id}@${input.revision}`)),
    });
    const handler = createFetchHandler({ router: serverRouter, createContext: () => ({}) });

    // The stale client was built against the old shape.
    const stale = rpc.context<{}>();
    const staleRouter = stale.router({
      byNumber: stale
        .procedure()
        .input(wire.object({ id: wire.string }))
        .output(wire.string)
        .query(({ input }) => ok(input.id)),
    });
    const localFetch = ((input: string | URL | Request, init?: RequestInit) =>
      handler(new Request(input, init))) as typeof globalThis.fetch;
    return { serverRouter, staleRouter, localFetch };
  };

  test("missing unary and batch contract stamps fail closed as version violations", async () => {
    const encoded = serialize({
      v: PROTOCOL_VERSION,
      status: "ok",
      value: { id: "one", value: "first" },
    });
    if (!encoded.ok) throw new Error("unary fixture did not serialize");
    for (const missingContract of [null, "", " "]) {
      const unstamped = createFixtureClient({
        router,
        contractVersion: "required-stamp",
        transport: {
          request: async () => ({
            ok: true,
            response: {
              status: 200,
              contentType: PROTOCOL_CONTENT_TYPE,
              body: encoded.value,
              contract: missingContract,
            },
          }),
        },
      });
      const unary = await unstamped.value.byId({ id: "one" });
      expect(unary.isOk()).toBe(false);
      if (!unary.isOk()) {
        expect(unary.error._tag).toBe("client/protocol-violation");
        expect(unary.error.data).toEqual({ reason: "version" });
      }
    }

    const noContractHeader = (async (input: string | URL | Request, init?: RequestInit) => {
      const response = await handler(new Request(input, init));
      const headers = new Headers(response.headers);
      headers.delete("x-result-rpc-contract");
      return new Response(response.body, { status: response.status, headers });
    }) as typeof globalThis.fetch;
    const batched = createFixtureClient({
      router,
      transport: batchFetchTransport({
        url: "https://example.test/rpc",
        fetch: noContractHeader,
      }),
    });
    const batch = await Promise.all([
      batched.value.byId({ id: "one" }),
      batched.value.byId({ id: "missing" }),
    ]);
    for (const result of batch) {
      expect(result.isOk()).toBe(false);
      if (!result.isOk()) {
        expect(result.error._tag).toBe("client/protocol-violation");
        expect(result.error.data).toEqual({ reason: "version" });
      }
    }
  });

  test("a stale client's contract failure becomes client/stale, once-per-client skew event included", async () => {
    const { staleRouter, localFetch } = makeSkewWorld();
    const events: ClientEvent[] = [];
    const client = createFixtureClient({
      router: staleRouter,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
      onEvent: (event) => void events.push(event),
    });

    const result = await client.byNumber({ id: "a" });
    expect(result.isOk()).toBe(false);
    if (result.isOk()) throw new Error("unreachable");
    expect(result.error._tag).toBe("client/stale");
    expect(result.error.data).toEqual({ reclassifiedFrom: "server/bad-request" });

    await client.byNumber({ id: "b" });
    const skews = events.filter((event) => event.type === "skew");
    expect(skews).toHaveLength(1);
    const failure = events.find((event) => event.type === "failure");
    expect(failure && "tag" in failure ? failure.tag : undefined).toBe("client/stale");
  });

  test("a stale batch agrees with unary skew classification and reports skew once", async () => {
    const { staleRouter, localFetch } = makeSkewWorld();
    const events: ClientEvent[] = [];
    const client = createFixtureClient({
      router: staleRouter,
      transport: batchFetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
      onEvent: (event) => void events.push(event),
    });

    const results = await Promise.all([client.byNumber({ id: "a" }), client.byNumber({ id: "b" })]);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.isOk()).toBe(false);
      if (!result.isOk()) {
        expect(result.error._tag).toBe("client/stale");
        expect(result.error.data).toEqual({ reclassifiedFrom: "server/bad-request" });
      }
    }
    expect(events.filter((event) => event.type === "skew")).toHaveLength(1);
  });

  test("matching contract stamps leave a genuine bad request as server/bad-request", async () => {
    const { staleRouter } = makeSkewWorld();
    // same build stamp on both sides: even a structurally different client
    // is treated as current, so the failure keeps its real tag
    const handlerSameStamp = createFetchHandler({
      router: makeSkewWorld().serverRouter,
      createContext: () => ({}),
      contractVersion: "build-42",
    });
    const sameStampFetch = ((input: string | URL | Request, init?: RequestInit) =>
      handlerSameStamp(new Request(input, init))) as typeof globalThis.fetch;
    const client = createFixtureClient({
      router: staleRouter,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: sameStampFetch }),
      contractVersion: "build-42",
    });
    const result = await client.byNumber({ id: "a" });
    expect(result.isOk()).toBe(false);
    if (result.isOk()) throw new Error("unreachable");
    expect(result.error._tag).toBe("server/bad-request");
  });

  test("a stale subscription reconciles its stream handshake before its first item", async () => {
    const server = rpc.context<{}>();
    const serverEvents = server
      .procedure()
      .input(wire.object({}))
      .output(wire.number)
      .subscription();
    const serverRouter = server.router({
      events: server.implement(serverEvents).stream(async function* () {
        yield ok(42);
      }),
    });
    const serverHandler = createFetchHandler({
      router: serverRouter,
      createContext: () => ({}),
    });

    const stale = rpc.context<{}>();
    const staleEvents = stale.procedure().input(wire.object({})).output(wire.string).subscription();
    const staleRouter = stale.contract({ events: staleEvents });
    const staleFetch = ((input: string | URL | Request, init?: RequestInit) =>
      serverHandler(new Request(input, init))) as typeof globalThis.fetch;
    const observed: ClientEvent[] = [];
    const staleClient = createFixtureClient({
      contract: staleRouter,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: staleFetch }),
      onEvent: (event) => void observed.push(event),
    });

    const received = [];
    for await (const item of staleClient.events({})) received.push(item);

    expect(received).toHaveLength(1);
    expect(received[0]?.isOk()).toBe(false);
    if (received[0] && !received[0].isOk()) {
      expect(received[0].error._tag).toBe("client/stale");
      expect(received[0].error.data).toEqual({
        reclassifiedFrom: "client/protocol-violation",
      });
    }
    for await (const _item of staleClient.events({})) {
      // A second mismatched stream still fails, but must not duplicate the
      // once-per-client deployment-skew signal.
    }
    expect(observed.filter((event) => event.type === "skew")).toHaveLength(1);
  });

  test("a mismatched custom stream is cancelled exactly once before decoding", async () => {
    let cancellations = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancellations += 1;
      },
    });
    const custom = createFixtureClient({
      router,
      contractVersion: "browser-build",
      transport: {
        request: async () => ({ ok: false, reason: "network" }),
        stream: async () => ({
          ok: true,
          response: {
            status: 200,
            contentType: STREAM_CONTENT_TYPE,
            body,
            contract: "server-build",
          },
        }),
      },
    });

    const received = [];
    for await (const item of custom.value.events({ fail: false })) received.push(item);

    expect(received).toHaveLength(1);
    expect(received[0] && !received[0].isOk() ? received[0].error._tag : undefined).toBe(
      "client/stale",
    );
    expect(cancellations).toBe(1);
  });

  test("a stream without a contract stamp is a protocol violation and is cancelled", async () => {
    let cancellations = 0;
    const custom = createFixtureClient({
      router,
      transport: {
        request: async () => ({ ok: false, reason: "network" }),
        stream: async () => ({
          ok: true,
          response: {
            status: 200,
            contentType: STREAM_CONTENT_TYPE,
            body: new ReadableStream<Uint8Array>({
              cancel() {
                cancellations += 1;
              },
            }),
            contract: null,
          },
        }),
      },
    });

    const received = [];
    for await (const item of custom.value.events({ fail: false })) received.push(item);

    expect(received).toHaveLength(1);
    expect(received[0] && !received[0].isOk() ? received[0].error._tag : undefined).toBe(
      "client/protocol-violation",
    );
    expect(cancellations).toBe(1);
  });

  test("breaking out of a custom stream cancels its reader exactly once", async () => {
    const encoded = serialize({
      v: PROTOCOL_VERSION,
      seq: 0,
      done: false,
      response: {
        v: PROTOCOL_VERSION,
        status: "ok",
        value: { at: new Date("2026-01-01T00:00:00.000Z"), sequence: 1n },
      },
    });
    if (!encoded.ok) throw new Error("stream fixture did not serialize");
    let cancellations = 0;
    const custom = createFixtureClient({
      router,
      contractVersion: "same-build",
      transport: {
        request: async () => ({ ok: false, reason: "network" }),
        stream: async () => ({
          ok: true,
          response: {
            status: 200,
            contentType: STREAM_CONTENT_TYPE,
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(`${encoded.value}\n`));
              },
              cancel() {
                cancellations += 1;
              },
            }),
            contract: "same-build",
          },
        }),
      },
    });

    for await (const item of custom.value.events({ fail: false })) {
      expect(item.isOk()).toBe(true);
      break;
    }

    expect(cancellations).toBe(1);
  });

  test("a malformed custom stream frame cancels its reader exactly once", async () => {
    let cancellations = 0;
    const custom = createFixtureClient({
      router,
      contractVersion: "same-build",
      transport: {
        request: async () => ({ ok: false, reason: "network" }),
        stream: async () => ({
          ok: true,
          response: {
            status: 200,
            contentType: STREAM_CONTENT_TYPE,
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("not-a-frame\n"));
              },
              cancel() {
                cancellations += 1;
              },
            }),
            contract: "same-build",
          },
        }),
      },
    });

    const received = [];
    for await (const item of custom.value.events({ fail: false })) received.push(item);

    expect(received).toHaveLength(1);
    expect(received[0] && !received[0].isOk() ? received[0].error._tag : undefined).toBe(
      "client/protocol-violation",
    );
    expect(cancellations).toBe(1);
  });

  test("closing a parked custom subscription aborts and cancels its reader exactly once", async () => {
    let cancellations = 0;
    const custom = createFixtureClient({
      router,
      contractVersion: "same-build",
      transport: {
        request: async () => ({ ok: false, reason: "network" }),
        stream: async () => ({
          ok: true,
          response: {
            status: 200,
            contentType: STREAM_CONTENT_TYPE,
            body: new ReadableStream<Uint8Array>({
              cancel() {
                cancellations += 1;
              },
            }),
            contract: "same-build",
          },
        }),
      },
    });
    const subscription = custom.value.events({ fail: false });
    const iterator = subscription[Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();

    subscription.close();

    await expect(pending).rejects.toEqual(cancelled);
    expect(cancellations).toBe(1);
  });
});

describe("content-type gate (CSRF surface)", () => {
  test("a request without the protocol content-type is rejected", async () => {
    // Binaries are out of band (a bucket reference on the contract), so there
    // is no simpler content-type the handler accepts. Every request must carry
    // the protocol content-type — a non-CORS-simple type that forces a
    // preflight, which is the uniform CSRF defense.
    const envelope = serialize({ v: PROTOCOL_VERSION, path: "value.byId", input: { id: "one" } });
    if (!envelope.ok) throw new Error("unreachable");
    for (const contentType of ["multipart/form-data", "text/plain", "application/json"]) {
      const response = await handler(
        new Request("https://example.test/rpc", {
          method: "POST",
          headers: { "content-type": contentType },
          body: envelope.value,
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("protocol/invalid-request");
    }
  });
});

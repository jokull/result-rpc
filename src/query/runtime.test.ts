import { describe, expect, test } from "bun:test";
import { err, error, ok, wire } from "../index.js";
import { createClient } from "../client/client.js";
import { cancelled, fetchTransport, type ClientTransport } from "../client/transport.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import type { AnyTaggedError } from "../error.js";
import { createQueryRuntime, type QueryState, type ResultQueryObserver } from "./runtime.js";

const Missing = error({
  tag: "query/missing",
  data: wire.object({ id: wire.string }),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
});
const Conflict = error({
  tag: "query/conflict",
  data: wire.object({ value: wire.string }),
  httpStatus: 409,
  retry: "never",
  visibility: "public",
});

const r = rpc.context<{ readonly values: ReadonlyMap<string, string> }>();
const byId = r
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.object({ id: wire.string, value: wire.string }))
  .errors({ Missing })
  .query(({ input, context, errors }) => {
    const value = context.values.get(input.id);
    return value === undefined
      ? err(errors.Missing({ id: input.id }))
      : ok({ id: input.id, value });
  });
const rename = r
  .procedure()
  .input(wire.object({ value: wire.string }))
  .output(wire.object({ value: wire.string }))
  .errors({ Conflict })
  .mutation(({ input, errors }) => input.value === "taken"
    ? err(errors.Conflict({ value: input.value }))
    : ok(input));
const eventsContract = r
  .procedure()
  .input(wire.object({ fail: wire.boolean }))
  .output(wire.object({ id: wire.string, value: wire.string }))
  .errors({ Missing })
  .subscription();
const events = r.implement(eventsContract).stream(async function* ({ input, errors }) {
  yield ok({ id: "one", value: "first" });
  if (input.fail) yield err(errors.Missing({ id: "two" }));
});
interface GraphInput {
  readonly sequence: bigint;
  readonly labels: ReadonlyMap<string, string>;
  self?: GraphInput;
}
const graph = r
  .procedure()
  .input(wire.serializable<GraphInput>())
  .output(wire.string)
  .query(({ input }) => ok(`${input.sequence}:${input.labels.get("region")}`));
const router = r.router({ value: { byId, rename, events, graph } });
const handler = createFetchHandler({
  router,
  createContext: () => ({ values: new Map([["one", "first"]]) }),
});
const localFetch = (async (input: string | URL | Request, init?: RequestInit) =>
  handler(new Request(input, init))) as typeof globalThis.fetch;

const waitFor = <T, E extends AnyTaggedError>(
  observer: ResultQueryObserver<T, E>,
  predicate: (state: QueryState<T, E>) => boolean,
): Promise<QueryState<T, E>> => new Promise((resolve, reject) => {
  let unsubscribe: () => void = () => undefined;
  const timeout = setTimeout(() => {
    unsubscribe();
    reject(new Error("Timed out waiting for query state"));
  }, 6_000);
  const check = () => {
    const state = observer.getCurrentState();
    if (!predicate(state)) return;
    clearTimeout(timeout);
    unsubscribe();
    resolve(state);
  };
  unsubscribe = observer.subscribe(check);
  check();
});

describe("reactive query runtime", () => {
  test("rejects procedures from a different client instance", () => {
    const transport = fetchTransport({ url: "https://example.test/rpc", fetch: localFetch });
    const client = createClient({ router, transport });
    const otherClient = createClient({ router, transport });
    const runtime = createQueryRuntime({ client });
    expect(() => runtime.observe(otherClient.value.byId, { id: "one" }))
      .toThrow("different result-rpc client");
    runtime.clear();
  });

  test("projects successful query data into one Result state", async () => {
    const client = createClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
    });
    const runtime = createQueryRuntime({ client });
    const observer = runtime.observe(client.value.byId, { id: "one" });
    expect(observer.getCurrentState().state).toBe("pending");
    const state = await waitFor(observer, (current) => current.state === "success");
    expect(state.result).toEqual({ ok: true, value: { id: "one", value: "first" } });
    observer.destroy();
    runtime.clear();
  });

  test("projects declared failures without treating Result.Err as cache data", async () => {
    const client = createClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
    });
    const runtime = createQueryRuntime({ client });
    const observer = runtime.observe(client.value.byId, { id: "missing" });
    const state = await waitFor(observer, (current) => current.state === "failure");
    expect(state.result).toEqual({ ok: false, error: Missing({ id: "missing" }) });
    expect(state.failureCount).toBe(1);
    observer.destroy();
    runtime.clear();
  });

  test("keys rich and cyclic inputs through the wire serializer", async () => {
    const client = createClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
    });
    const runtime = createQueryRuntime({ client });
    const input: GraphInput = {
      sequence: 8n,
      labels: new Map([["region", "north"]]),
    };
    input.self = input;
    const observer = runtime.observe(client.value.graph, input);
    const state = await waitFor(observer, (current) => current.state === "success");
    expect(state.result).toEqual(ok("8:north"));
    expect(typeof observer.key[1]).toBe("string");
    observer.destroy();
    runtime.clear();
  });

  test("retries transient tagged client failures from definition policy", async () => {
    let attempts = 0;
    const local = fetchTransport({ url: "https://example.test/rpc", fetch: localFetch });
    const transport: ClientTransport = {
      request: async (...args) => {
        attempts += 1;
        if (attempts < 3) return { ok: false, reason: "network" };
        return local.request(...args);
      },
    };
    const client = createClient({ router, transport });
    const runtime = createQueryRuntime({ client });
    const observer = runtime.observe(client.value.byId, { id: "one" });
    const state = await waitFor(observer, (current) => current.state === "success");
    expect(state.state).toBe("success");
    if (state.state === "success") expect(state.result.value.value).toBe("first");
    expect(attempts).toBe(3);
    observer.destroy();
    runtime.clear();
  });

  test("keeps previous success after a failed background refetch", async () => {
    let fail = false;
    const local = fetchTransport({ url: "https://example.test/rpc", fetch: localFetch });
    const transport: ClientTransport = {
      request: (...args) => fail
        ? Promise.resolve({ ok: false, reason: "network" })
        : local.request(...args),
    };
    const client = createClient({ router, transport });
    const runtime = createQueryRuntime({ client });
    const observer = runtime.observe(client.value.byId, { id: "one" }, { retry: false });
    await waitFor(observer, (current) => current.state === "success");
    fail = true;
    const state = await observer.refetch();
    expect(state.state).toBe("failure");
    if (state.state === "failure") {
      expect(state.result.error._tag).toBe("client/network-failure");
      expect(state.previous).toEqual({ id: "one", value: "first" });
    }
    observer.destroy();
    runtime.clear();
  });

  test("projects mutations through the same Result channel", async () => {
    const client = createClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
    });
    const runtime = createQueryRuntime({ client });
    const mutation = runtime.mutation(client.value.rename);
    const unsubscribe = mutation.subscribe(() => undefined);

    const success = await mutation.mutate({ value: "available" });
    expect(success).toEqual({ ok: true, value: { value: "available" } });
    expect(mutation.getCurrentState().state).toBe("success");

    const failure = await mutation.mutate({ value: "taken" });
    expect(failure).toEqual({ ok: false, error: Conflict({ value: "taken" }) });
    expect(mutation.getCurrentState().state).toBe("failure");

    unsubscribe();
    mutation.destroy();
    runtime.clear();
  });

  test("rolls back optimistic cache updates before publishing failure", async () => {
    const client = createClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
    });
    const runtime = createQueryRuntime({ client });
    runtime.cache.update(client.value.byId, { id: "one" }, () => ({
      id: "one",
      value: "first",
    }));
    const mutation = runtime.mutation(client.value.rename, {
      retry: false,
      optimistic: ({ value }, cache) => ({
        rollback: cache.update(client.value.byId, { id: "one" }, (current) =>
          current === undefined ? undefined : { ...current, value }),
      }),
      onFailure: (_failure, _input, context) => {
        (context as { rollback(): void }).rollback();
      },
    });

    const pending = mutation.mutate({ value: "taken" });
    expect(runtime.cache.get(client.value.byId, { id: "one" })?.value).toBe("taken");
    expect(await pending).toEqual(err(Conflict({ value: "taken" })));
    expect(runtime.cache.get(client.value.byId, { id: "one" })?.value).toBe("first");

    mutation.destroy();
    runtime.clear();
  });

  test("treats mutation cancellation as lifecycle rather than Err", async () => {
    const transport: ClientTransport = {
      request: async (_envelope, options) => new Promise((_resolve, reject) => {
        if (options?.signal?.aborted) return reject(cancelled);
        options?.signal?.addEventListener("abort", () => reject(cancelled), { once: true });
      }),
    };
    const client = createClient({ router, transport });
    const runtime = createQueryRuntime({ client });
    let failureCalled = false;
    let settledCalled = false;
    let cancelCalled = false;
    const mutation = runtime.mutation(client.value.rename, {
      retry: false,
      optimistic: () => ({ rollback: true }),
      onFailure: () => { failureCalled = true; },
      onSettled: () => { settledCalled = true; },
      onCancel: (_input, context) => { cancelCalled = context?.rollback === true; },
    });
    const pending = mutation.mutate({ value: "available" });
    mutation.cancel();
    await expect(pending).rejects.toEqual(cancelled);
    expect(mutation.getCurrentState().state).toBe("idle");
    expect(failureCalled).toBe(false);
    expect(settledCalled).toBe(false);
    expect(cancelCalled).toBe(true);
    mutation.destroy();
    runtime.clear();
  });

  test("dehydrates only successful cache data through the versioned serializer", async () => {
    const client = createClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
    });
    const serverRuntime = createQueryRuntime({ client });
    const serverObserver = serverRuntime.observe(
      client.value.byId,
      { id: "one" },
      { staleTime: 60_000 },
    );
    await waitFor(serverObserver, (current) => current.state === "success");
    const dehydrated = serverRuntime.dehydrate();

    const browserRuntime = createQueryRuntime({ client });
    browserRuntime.hydrate(dehydrated);
    const browserObserver = browserRuntime.observe(
      client.value.byId,
      { id: "one" },
      { staleTime: 60_000 },
    );
    const state = browserObserver.getCurrentState();
    expect(state).toMatchObject({
      state: "success",
      result: { ok: true, value: { id: "one", value: "first" } },
    });

    serverObserver.destroy();
    browserObserver.destroy();
    serverRuntime.clear();
    browserRuntime.clear();
  });

  test("rejects hydrated success data that fails the procedure output codec", () => {
    const client = createClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
    });
    const source = createQueryRuntime({ client });
    source.cache.update(
      client.value.byId,
      { id: "one" },
      () => ({ hostile: true }) as never,
    );
    const state = source.dehydrate();

    const target = createQueryRuntime({ client });
    target.hydrate(state);
    const observer = target.observe(client.value.byId, { id: "one" }, { enabled: false });
    expect(observer.getCurrentState().state).toBe("pending");

    observer.destroy();
    source.clear();
    target.clear();
  });

  test("projects subscription events and terminal errors into one Result", async () => {
    const client = createClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
    });
    const runtime = createQueryRuntime({ client });
    const subscription = runtime.subscription(client.value.events, { fail: true });
    const terminal = await new Promise<ReturnType<typeof subscription.getCurrentState>>(
      (resolve) => {
        const unsubscribe = subscription.subscribe(() => {
          const state = subscription.getCurrentState();
          if (state.connection === "closed" && !state.result?.ok) {
            unsubscribe();
            resolve(state);
          }
        });
      },
    );
    expect(terminal.eventCount).toBe(1);
    expect(terminal.result).toEqual(err(Missing({ id: "two" })));
    subscription.close();
    runtime.clear();
  });

  test("keeps transient subscription failures in reconnect lifecycle", async () => {
    let attempts = 0;
    const local = fetchTransport({ url: "https://example.test/rpc", fetch: localFetch });
    const transport: ClientTransport = {
      request: (...args) => local.request(...args),
      stream: (...args) => {
        attempts += 1;
        return attempts === 1
          ? Promise.resolve({ ok: false, reason: "network" })
          : local.stream!(...args);
      },
    };
    const client = createClient({ router, transport });
    const runtime = createQueryRuntime({ client });
    const subscription = runtime.subscription(
      client.value.events,
      { fail: false },
      { retryDelayMs: 0 },
    );
    const seen: string[] = [];
    const closed = await new Promise<ReturnType<typeof subscription.getCurrentState>>(
      (resolve) => {
        const unsubscribe = subscription.subscribe(() => {
          const state = subscription.getCurrentState();
          seen.push(state.connection);
          if (state.connection === "closed" && state.result?.ok) {
            unsubscribe();
            resolve(state);
          }
        });
      },
    );
    expect(seen).toContain("reconnecting");
    expect(attempts).toBe(2);
    expect(closed.eventCount).toBe(1);
    expect(closed.result).toEqual(ok({ id: "one", value: "first" }));
    subscription.close();
    runtime.clear();
  });

  test("pauses offline subscriptions without publishing a terminal error", async () => {
    const transport: ClientTransport = {
      request: async () => ({ ok: false, reason: "offline" }),
      stream: async () => ({ ok: false, reason: "offline" }),
    };
    const client = createClient({ router, transport });
    const runtime = createQueryRuntime({ client });
    const subscription = runtime.subscription(client.value.events, { fail: false });
    const paused = await new Promise<ReturnType<typeof subscription.getCurrentState>>(
      (resolve) => {
        const unsubscribe = subscription.subscribe(() => {
          const state = subscription.getCurrentState();
          if (state.connection === "paused") {
            unsubscribe();
            resolve(state);
          }
        });
      },
    );
    expect(paused.result).toBeUndefined();
    expect(paused.eventCount).toBe(0);
    subscription.close();
    runtime.clear();
  });
});

describe("declared invalidation", () => {
  test("a mutation's .affects() invalidates the target query, code-first and mapped", async () => {
    const app = rpc.context<{ readonly state: { revision: number; titles: Map<string, string> } }>();
    const docById = app.procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.object({ id: wire.string, title: wire.string, revision: wire.number }))
      .query(({ input, context }) => ok({
        id: input.id,
        title: context.state.titles.get(input.id) ?? "untitled",
        revision: context.state.revision,
      }));
    const bump = app.procedure()
      .input(wire.object({ id: wire.string, title: wire.string }))
      .output(wire.string)
      .affects(docById, (input) => ({ id: input.id }))
      .mutation(({ input, context }) => {
        context.state.revision += 1;
        context.state.titles.set(input.id, input.title);
        return ok(input.title);
      });
    const affectsRouter = app.router({ doc: { byId: docById, bump } });
    const state = { revision: 1, titles: new Map([["a", "first"]]) };
    const affectsHandler = createFetchHandler({ router: affectsRouter, createContext: () => ({ state }) });
    const client = createClient({
      router: affectsRouter,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: (async (input: string | URL | Request, init?: RequestInit) =>
          affectsHandler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client });

    const observer = runtime.observe(client.doc.byId, { id: "a" });
    const unsubscribe = observer.subscribe(() => undefined);
    await waitFor(observer, (current) => current.state === "success");
    const before = observer.getCurrentState();
    if (before.state !== "success") throw new Error("unreachable");
    expect(before.result.value.revision).toBe(1);

    // No onSettled anywhere: the contract's .affects() drives the refetch.
    const mutation = runtime.mutation(client.doc.bump);
    const result = await mutation.getCurrentState().mutate({ id: "a", title: "renamed" });
    expect(result.ok).toBe(true);

    await waitFor(observer, (current) =>
      current.state === "success" && current.result.value.revision === 2);
    const after = observer.getCurrentState();
    if (after.state !== "success") throw new Error("unreachable");
    expect(after.result.value.title).toBe("renamed");

    unsubscribe();
    observer.destroy();
    mutation.destroy();
    runtime.clear();
  });

  test(".affects() is rejected on queries and non-query targets", () => {
    const app = rpc.context<{}>();
    const target = app.procedure().output(wire.string).query(() => ok("x"));
    const mutationTarget = app.procedure().output(wire.string).mutation(() => ok("x"));
    expect(() => app.procedure()
      .output(wire.string)
      .affects(target)
      .query(() => ok("x"))).toThrow("Only mutations declare .affects()");
    expect(() => app.procedure()
      .output(wire.string)
      // @ts-expect-error mutations cannot be invalidation targets
      .affects(mutationTarget)).toThrow("affects() targets must be query procedures");
  });
});

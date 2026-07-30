/**
 * A confirmed entity write must survive a hydration payload that was produced
 * before it.
 *
 * The two are on a collision course by construction: a patch deliberately does
 * not launder staleness, so it leaves `dataUpdatedAt` at the value the last
 * real fetch set. TanStack's hydrate overwrites any query older than the
 * payload. So a snapshot taken after the original fetch but before the mutation
 * outranks the mutation's own result — and under `staleTime > 0` nothing ever
 * refetches to repair it.
 */
import { describe, expect, test } from "bun:test";
import { ok, wire } from "../index.js";
import { createFixtureClient } from "../testing/index.js";
import { fetchTransport } from "../client/transport.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { defineModel } from "../model.js";
import { createQueryRuntime, type ResultQueryObserver } from "./runtime.js";
import type { AnyTaggedError } from "../error.js";

const User = defineModel("hydration-patch-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});

const app = rpc.context<{}>();
const me = app
  .procedure()
  .output(User.all("test fixture"))
  .query(() => ok({ id: "u1", name: "Ada" }));
const router = app.router({ me });
const handler = createFetchHandler({ router, createContext: () => ({}) });

const makeClient = () =>
  createFixtureClient({
    router,
    transport: fetchTransport({
      url: "https://example.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof globalThis.fetch,
    }),
  });

const waitFor = async <T>(
  observer: ResultQueryObserver<T, AnyTaggedError>,
  predicate: (state: ReturnType<typeof observer.getCurrentState>) => boolean,
) => {
  if (predicate(observer.getCurrentState())) return;
  await new Promise<void>((resolve) => {
    const stop = observer.subscribe(() => {
      if (!predicate(observer.getCurrentState())) return;
      stop();
      resolve();
    });
  });
};

const STALE = 60_000;

describe("a hydration payload older than a confirmed patch", () => {
  test("does not revert the patched entity", async () => {
    const client = makeClient();

    // t0 — the browser fetches and caches the row.
    const browser = createQueryRuntime({ client });
    const observer = browser.observe(client.me, {}, { staleTime: STALE });
    const stop = observer.subscribe(() => undefined);
    await waitFor(observer, (s) => s.state === "success");
    expect(observer.getCurrentState().value).toMatchObject({ name: "Ada" });

    // t1 — a server render of the same query, dehydrated. Strictly newer than
    // the browser's copy, which is what makes it win the hydrate comparison.
    await Bun.sleep(5);
    const server = createQueryRuntime({ client });
    await server.prefetch(client.me, {});
    const payload = server.dehydrate();

    // t2 — a mutation's confirmed result patches the entity in place.
    await Bun.sleep(5);
    browser.cache.updateEntity(User, "u1", () => ({ name: "Grace" }));
    expect(observer.getCurrentState().value).toMatchObject({ name: "Grace" });

    // The payload predates the write, so it must not win.
    browser.hydrate(payload);
    expect(observer.getCurrentState().value).toMatchObject({ name: "Grace" });

    stop();
    observer.destroy();
    browser.clear();
    server.clear();
  });

  test("leaves the query due for reconciliation rather than silently stale", async () => {
    const client = makeClient();
    const browser = createQueryRuntime({ client });
    const observer = browser.observe(client.me, {}, { staleTime: STALE });
    const stop = observer.subscribe(() => undefined);
    await waitFor(observer, (s) => s.state === "success");

    await Bun.sleep(5);
    const server = createQueryRuntime({ client });
    await server.prefetch(client.me, {});
    const payload = server.dehydrate();

    await Bun.sleep(5);
    browser.cache.updateEntity(User, "u1", () => ({ name: "Grace" }));
    browser.hydrate(payload);

    // Keeping the local write is only half the answer: the payload disagreed,
    // so the query must not sit there under staleTime believing it is fresh.
    expect(observer.getCurrentState().isStale).toBe(true);

    stop();
    observer.destroy();
    browser.clear();
    server.clear();
  });

  test("still applies a payload to a query with no local write", async () => {
    // The guard must not turn hydration into a no-op.
    const client = makeClient();
    const server = createQueryRuntime({ client });
    await server.prefetch(client.me, {});
    const payload = server.dehydrate();

    const browser = createQueryRuntime({ client });
    browser.hydrate(payload);
    const observer = browser.observe(client.me, {}, { staleTime: STALE });
    expect(observer.getCurrentState()).toMatchObject({
      state: "success",
      value: { id: "u1", name: "Ada" },
    });

    observer.destroy();
    browser.clear();
    server.clear();
  });
});

/**
 * Attack 14: formerly-colliding identities must remain isolated through every
 * cache path. These are integration regressions for the two destructive
 * collisions the old `String(part).join(":")` representation admitted.
 */
import { describe, expect, test } from "bun:test";
import { fetchTransport } from "../../src/client/transport.js";
import { ok, wire } from "../../src/index.js";
import { defineModel } from "../../src/model.js";
import { createQueryRuntime } from "../../src/query/runtime.js";
import { createFetchHandler } from "../../src/server/index.js";
import { rpc } from "../../src/server/contract.js";
import { createFixtureClient } from "../../src/testing/index.js";
import { sleep, waitFor } from "./harness.js";

const Localized = defineModel("a14-localized", {
  key: ["id", "locale"],
  shape: { id: wire.string, locale: wire.string, title: wire.string },
});

const Scalar = defineModel("a14-scalar", {
  key: "id",
  shape: { id: wire.union([wire.string, wire.number]), title: wire.string },
});

const boot = () => {
  const counts = { left: 0, right: 0, numeric: 0, textual: 0 };
  const app = rpc.context<{ readonly counts: typeof counts }>();
  const left = app
    .procedure()
    .output(Localized.all("identity collision fixture"))
    .query(({ context }) => {
      context.counts.left += 1;
      return ok({ id: "a:b", locale: "c", title: "left" });
    });
  const right = app
    .procedure()
    .output(Localized.all("identity collision fixture"))
    .query(({ context }) => {
      context.counts.right += 1;
      return ok({ id: "a", locale: "b:c", title: "right" });
    });
  const numeric = app
    .procedure()
    .output(Scalar.all("identity collision fixture"))
    .query(({ context }) => {
      context.counts.numeric += 1;
      return ok({ id: 1, title: "numeric" });
    });
  const textual = app
    .procedure()
    .output(Scalar.all("identity collision fixture"))
    .query(({ context }) => {
      context.counts.textual += 1;
      return ok({ id: "1", title: "textual" });
    });
  const liveLeftContract = app
    .procedure()
    .output(Localized.all("identity collision fixture"))
    .subscription();
  const liveLeft = app.implement(liveLeftContract).stream(async function* () {
    yield ok({ id: "a:b", locale: "c", title: "streamed-left" });
  });
  const router = app.router({ left, right, numeric, textual, liveLeft });
  const handler = createFetchHandler({ router, createContext: () => ({ counts }) });
  const client = createFixtureClient({
    router,
    transport: fetchTransport({
      url: "https://identity-collision.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof globalThis.fetch,
    }),
  });
  return { client, counts };
};

describe("attack-14 canonical identity collisions", () => {
  test("patch, rollback, lookup, and invalidation isolate delimiter collisions", async () => {
    const { client, counts } = boot();
    const runtime = createQueryRuntime({ client });
    const left = runtime.observe(client.left, {});
    const right = runtime.observe(client.right, {});
    const stopLeft = left.subscribe(() => undefined);
    const stopRight = right.subscribe(() => undefined);
    await waitFor(left, (state) => state.state === "success");
    await waitFor(right, (state) => state.state === "success");

    const rollback = runtime.cache.updateEntity(
      Localized,
      { id: "a:b", locale: "c" },
      (current) => ({ ...current, title: "optimistic-left" }),
    );
    expect(runtime.cache.get(client.left, {})?.title).toBe("optimistic-left");
    expect(runtime.cache.get(client.right, {})?.title).toBe("right");

    rollback();
    expect(runtime.cache.get(client.left, {})?.title).toBe("left");
    expect(runtime.cache.get(client.right, {})?.title).toBe("right");

    await runtime.cache.invalidateEntity(Localized, { id: "a:b", locale: "c" });
    expect(counts).toEqual({ left: 2, right: 1, numeric: 0, textual: 0 });

    stopLeft();
    stopRight();
    left.destroy();
    right.destroy();
    runtime.clear();
  });

  test("patch and invalidation distinguish numeric 1 from string 1", async () => {
    const { client, counts } = boot();
    const runtime = createQueryRuntime({ client });
    const numeric = runtime.observe(client.numeric, {});
    const textual = runtime.observe(client.textual, {});
    const stopNumeric = numeric.subscribe(() => undefined);
    const stopTextual = textual.subscribe(() => undefined);
    await waitFor(numeric, (state) => state.state === "success");
    await waitFor(textual, (state) => state.state === "success");

    runtime.cache.updateEntity(Scalar, 1, (current) => ({
      ...current,
      title: "patched-number",
    }));
    expect(runtime.cache.get(client.numeric, {})?.title).toBe("patched-number");
    expect(runtime.cache.get(client.textual, {})?.title).toBe("textual");

    await runtime.cache.invalidateEntity(Scalar, 1);
    expect(counts).toEqual({ left: 0, right: 0, numeric: 2, textual: 1 });

    stopNumeric();
    stopTextual();
    numeric.destroy();
    textual.destroy();
    runtime.clear();
  });

  test("hydration reindexing preserves collision boundaries", async () => {
    const { client } = boot();
    const server = createQueryRuntime({ client });
    const serverLeft = server.observe(client.left, {}, { staleTime: 60_000 });
    const serverRight = server.observe(client.right, {}, { staleTime: 60_000 });
    const stopServerLeft = serverLeft.subscribe(() => undefined);
    const stopServerRight = serverRight.subscribe(() => undefined);
    await waitFor(serverLeft, (state) => state.state === "success");
    await waitFor(serverRight, (state) => state.state === "success");
    const dehydrated = server.dehydrate();
    stopServerLeft();
    stopServerRight();
    serverLeft.destroy();
    serverRight.destroy();
    server.clear();

    const browser = createQueryRuntime({ client });
    browser.hydrate(dehydrated);
    const browserLeft = browser.observe(client.left, {}, { staleTime: 60_000 });
    const browserRight = browser.observe(client.right, {}, { staleTime: 60_000 });
    const stopBrowserLeft = browserLeft.subscribe(() => undefined);
    const stopBrowserRight = browserRight.subscribe(() => undefined);
    await sleep(10);

    browser.cache.updateEntity(Localized, { id: "a:b", locale: "c" }, (current) => ({
      ...current,
      title: "hydrated-left",
    }));
    expect(browser.cache.get(client.left, {})?.title).toBe("hydrated-left");
    expect(browser.cache.get(client.right, {})?.title).toBe("right");

    stopBrowserLeft();
    stopBrowserRight();
    browserLeft.destroy();
    browserRight.destroy();
    browser.clear();
  });

  test("a colliding subscription event cannot patch the other identity", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const right = runtime.observe(client.right, {});
    const stopRight = right.subscribe(() => undefined);
    await waitFor(right, (state) => state.state === "success");

    const live = runtime.subscription(client.liveLeft, {});
    await new Promise<void>((resolve) => {
      const unsubscribe = live.subscribe(() => {
        if (live.getCurrentState().eventCount > 0) {
          unsubscribe();
          resolve();
        }
      });
    });
    await sleep(10);

    expect(runtime.cache.get(client.right, {})?.title).toBe("right");

    live.close();
    stopRight();
    right.destroy();
    runtime.clear();
  });
});

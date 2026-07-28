/**
 * Attack 3: app-made copies are unbranded, and the design has no recovery.
 *
 * 3a: an `optimistic:` updater does the idiomatic thing — spreads a cached
 * row ({...row, title}) via cache.update. The spread copy is unbranded, so
 * the reindex on the 'updated' event silently DROPS the entity from the
 * index, and a later mutation-driven entity patch misses the query. The row
 * shows stale data until an unrelated refetch — and invalidateEntity misses
 * it too (same index).
 *
 * 3b: structuredClone strips brands (WeakMap identity) — collectEntities
 * finds nothing in the clone.
 */
import { describe, expect, test } from "bun:test";
import { ok, wire } from "../../src/index.js";
import { createClient } from "../../src/client/client.js";
import { fetchTransport } from "../../src/client/transport.js";
import { createFetchHandler } from "../../src/server/index.js";
import { rpc } from "../../src/server/contract.js";
import { createQueryRuntime } from "../../src/query/runtime.js";
import { defineModel, collectEntities } from "../../src/model.js";
import { waitFor, sleep } from "./harness.js";

const User = defineModel("a03-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string, avatarUrl: wire.string },
});

const boot = () => {
  const app = rpc.context<{
    readonly db: { user: { id: string; name: string; avatarUrl: string } };
  }>();
  const me = app
    .procedure()
    .output(User.all("test fixture"))
    .query(({ context }) => ok(context.db.user));
  const setAvatar = app
    .procedure()
    .input(wire.object({ avatarUrl: wire.string }))
    .output(User.all("test fixture"))
    .mutation(({ input, context }) => {
      context.db.user = { ...context.db.user, avatarUrl: input.avatarUrl };
      return ok(context.db.user);
    });
  const router = app.router({ me, setAvatar });
  const db = { user: { id: "u1", name: "J", avatarUrl: "v1.png" } };
  const handler = createFetchHandler({ router, createContext: () => ({ db }) });
  const client = createClient({
    router,
    transport: fetchTransport({
      url: "https://probe.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof globalThis.fetch,
    }),
  });
  return { client };
};

describe("attack-03 unbranded copies", () => {
  test("3a: a spread-copy in cache.update unbrands the row — later entity patch misses it", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const header = runtime.observe(client.me, {});
    const stop = header.subscribe(() => undefined);
    await waitFor(header, (s) => s.state === "success");

    // The idiomatic optimistic update an app would write:
    runtime.cache.update(client.me, {}, (current) =>
      current === undefined ? undefined : { ...current, name: "Optimistic" },
    );

    // Mutation succeeds and returns the fresh User entity...
    const mutation = runtime.mutation(client.setAvatar);
    const result = await mutation.getCurrentState().mutate({ avatarUrl: "v2.png" });
    expect(result.ok).toBe(true);
    await sleep(20);

    // ATTACK ASSERTION: the flagship promise — a returned entity patches
    // every containing query. But the spread copy lost its brand, the
    // reindex dropped user:u1 from this query, and the patch missed.
    const state = header.getCurrentState();
    if (state.state !== "success") throw new Error("unreachable");
    expect(state.value.avatarUrl).toBe("v2.png");

    stop();
    header.destroy();
    mutation.destroy();
    runtime.clear();
  });

  test("3a-control: without the spread the patch lands", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const header = runtime.observe(client.me, {});
    const stop = header.subscribe(() => undefined);
    await waitFor(header, (s) => s.state === "success");

    const mutation = runtime.mutation(client.setAvatar);
    await mutation.getCurrentState().mutate({ avatarUrl: "v2.png" });
    await sleep(20);

    const state = header.getCurrentState();
    if (state.state !== "success") throw new Error("unreachable");
    expect(state.value.avatarUrl).toBe("v2.png");

    stop();
    header.destroy();
    mutation.destroy();
    runtime.clear();
  });

  test("3b: structuredClone strips the brand — the clone collects nothing", () => {
    const decoded = User.all("test fixture").decode({ id: "u1", name: "J", avatarUrl: "v1.png" });
    if (!decoded.ok) throw new Error("decode failed");
    expect(collectEntities([decoded.value]).length).toBe(1);
    const clone = structuredClone(decoded.value);
    // DOCUMENTED LIMITATION: brands ride the WeakMap, not the object —
    // structuredClone (and any channel that reconstructs objects outside the
    // decode/share/patch pipeline) produces inert data. The share pass
    // recovers spreads written INTO the cache (3a control above); a clone
    // held outside the cache is just data.
    expect(collectEntities([clone]).length).toBe(0);
  });
});

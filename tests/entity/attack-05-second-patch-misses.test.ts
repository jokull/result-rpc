/**
 * Attack 5: the first patch destroys the brands; the second patch misses.
 *
 * patchQueriesWith writes the patched root via queryClient.setQueryData.
 * query-core's structural sharing (replaceEqualDeep) then MERGES old and new
 * data — and for any changed entity object it constructs a fresh plain-object
 * copy, which carries no WeakMap brand. The reindex on the 'updated' event
 * walks that merged value, finds no branded objects, and drops the entity
 * from the index. Result: entity write-through works exactly once per query;
 * every subsequent mutation's patch (and touch/writes invalidation, same
 * index) silently misses.
 *
 * The flagship test in runtime.test.ts only ever patches once.
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

const User = defineModel("a05-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string, avatarUrl: wire.string },
});

const boot = () => {
  const app = rpc.context<{ readonly db: { user: { id: string; name: string; avatarUrl: string } } }>();
  const me = app.procedure().output(User.all("test fixture")).query(({ context }) => ok(context.db.user));
  const setAvatar = app.procedure()
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

describe("attack-05 repeated patches", () => {
  test("the second mutation's entity patch still lands", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const header = runtime.observe(client.me, {});
    const stop = header.subscribe(() => undefined);
    await waitFor(header, (s) => s.state === "success");

    const mutation = runtime.mutation(client.setAvatar);
    await mutation.getCurrentState().mutate({ avatarUrl: "v2.png" });
    await sleep(20);
    const afterFirst = header.getCurrentState();
    if (afterFirst.state !== "success") throw new Error("unreachable");
    expect(afterFirst.value.avatarUrl).toBe("v2.png"); // first patch lands

    // Mechanism probe: is the cached (post-setQueryData) object still branded?
    const cached = runtime.cache.get(client.me, {});
    const stillBranded = collectEntities([cached]).length;

    await mutation.getCurrentState().mutate({ avatarUrl: "v3.png" });
    await sleep(20);
    const afterSecond = header.getCurrentState();
    if (afterSecond.state !== "success") throw new Error("unreachable");
    // ATTACK ASSERTION: the second patch must land too.
    expect({ avatarUrl: afterSecond.value.avatarUrl, stillBranded })
      .toEqual({ avatarUrl: "v3.png", stillBranded: 1 });

    stop(); header.destroy(); mutation.destroy(); runtime.clear();
  });

  test("cache.updateEntity twice: the second optimistic patch still lands", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const header = runtime.observe(client.me, {});
    const stop = header.subscribe(() => undefined);
    await waitFor(header, (s) => s.state === "success");

    runtime.cache.updateEntity(User, "u1", (u) => ({ ...u, name: "N2" }));
    const first = runtime.cache.get(client.me, {});
    expect(first?.name).toBe("N2");

    runtime.cache.updateEntity(User, "u1", (u) => ({ ...u, name: "N3" }));
    const second = runtime.cache.get(client.me, {});
    // ATTACK ASSERTION
    expect(second?.name).toBe("N3");

    stop(); header.destroy(); runtime.clear();
  });
});

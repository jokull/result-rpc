/**
 * Attack 8a: updateEntity's rollback restores WHOLE-QUERY snapshots, so a
 * rollback that fires after another writer patched the same query clobbers
 * the later, correct write (classic snapshot-rollback vs targeted-write).
 *
 * Attack 8b (React bridge): a no-op entity patch (values identical) must not
 * notify observers. mergeByExistingKeys returns the original when unchanged
 * and patchQueriesWith skips setQueryData — pin it.
 *
 * Attack 8c (React bridge): does patching one entity in a two-row list keep
 * the identity of the untouched sibling row (memoized row components)?
 * patchEntity clones every container, but query-core's replaceEqualDeep on
 * setQueryData restores identity for deep-equal subtrees — pin whichever
 * holds.
 */
import { describe, expect, test } from "bun:test";
import { ok, wire } from "../../src/index.js";
import { createClient } from "../../src/client/client.js";
import { fetchTransport } from "../../src/client/transport.js";
import { createFetchHandler } from "../../src/server/index.js";
import { rpc } from "../../src/server/contract.js";
import { createQueryRuntime } from "../../src/query/runtime.js";
import { defineModel } from "../../src/model.js";
import { waitFor } from "./harness.js";

const User = defineModel("a08-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string, avatarUrl: wire.string },
});

const boot = () => {
  const app = rpc.context<{ readonly db: { users: Map<string, { id: string; name: string; avatarUrl: string }> } }>();
  const list = app.procedure()
    .output(wire.array(User.codec))
    .query(({ context }) => ok([...context.db.users.values()]));
  const router = app.router({ list });
  const db = { users: new Map([
    ["u1", { id: "u1", name: "Alice", avatarUrl: "a1.png" }],
    ["u2", { id: "u2", name: "Bob", avatarUrl: "b1.png" }],
  ]) };
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

describe("attack-08 rollback and notify", () => {
  test("8a: rollback of patch #1 must not clobber the later patch #2 (different entity, same query)", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const users = runtime.observe(client.list, {});
    const stop = users.subscribe(() => undefined);
    await waitFor(users, (s) => s.state === "success");

    // optimistic patch #1 on u1 — keeps a whole-query snapshot as rollback
    const rollback1 = runtime.cache.updateEntity(User, "u1", (u) => ({ ...u, name: "Alice*" }));
    // a second, INDEPENDENT and correct write on u2 lands afterwards
    runtime.cache.updateEntity(User, "u2", (u) => ({ ...u, name: "Bob-confirmed" }));
    // patch #1's mutation fails: rollback
    rollback1();

    const state = users.getCurrentState();
    if (state.state !== "success") throw new Error("unreachable");
    const byId = new Map(state.value.map((u) => [u.id, u]));
    expect(byId.get("u1")!.name).toBe("Alice"); // rolled back — fine
    // ATTACK ASSERTION: u2's confirmed write must survive u1's rollback.
    expect(byId.get("u2")!.name).toBe("Bob-confirmed");

    stop(); users.destroy(); runtime.clear();
  });

  test("8b: a value-identical patch does not notify observers", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const users = runtime.observe(client.list, {});
    let notifications = 0;
    const stop = users.subscribe(() => { notifications += 1; });
    await waitFor(users, (s) => s.state === "success");
    const before = notifications;

    runtime.cache.updateEntity(User, "u1", (u) => ({ ...u })); // no field changes
    await new Promise((r) => setTimeout(r, 10));
    expect(notifications).toBe(before);

    stop(); users.destroy(); runtime.clear();
  });

  test("8c: patching u1 preserves the u2 row's object identity", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const users = runtime.observe(client.list, {});
    const stop = users.subscribe(() => undefined);
    await waitFor(users, (s) => s.state === "success");
    const before = users.getCurrentState();
    if (before.state !== "success") throw new Error("unreachable");
    const bobBefore = before.value.find((u) => u.id === "u2");

    runtime.cache.updateEntity(User, "u1", (u) => ({ ...u, avatarUrl: "a2.png" }));
    const after = users.getCurrentState();
    if (after.state !== "success") throw new Error("unreachable");
    expect(after.value.find((u) => u.id === "u1")!.avatarUrl).toBe("a2.png");
    // React-bridge assertion: untouched row keeps identity (memo-friendly).
    expect(after.value.find((u) => u.id === "u2")).toBe(bobBefore!);

    stop(); users.destroy(); runtime.clear();
  });
});

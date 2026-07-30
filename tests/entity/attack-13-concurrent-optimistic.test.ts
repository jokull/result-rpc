/**
 * Attack 13 (from the Relay/Zero gap review): two optimistic mutations touch
 * the same entity; mutation A's AUTHORITATIVE response lands after mutation
 * B's write has been confirmed. Without a guard, A's stale snapshot patches
 * over B's confirmed delta — arrival order beats server order.
 *
 * Desired semantics: a response that arrives out of start-order for an
 * entity must not patch stale fields over newer confirmed state; the cache
 * converges to the server without manual reconciliation.
 */
import { describe, expect, test } from "bun:test";
import { ok, wire } from "../../src/index.js";
import { createFixtureClient } from "../../src/testing/index.js";
import { fetchTransport } from "../../src/client/transport.js";
import { createFetchHandler } from "../../src/server/index.js";
import { rpc } from "../../src/server/contract.js";
import { createQueryRuntime } from "../../src/query/runtime.js";
import { defineModel } from "../../src/model.js";
import { waitFor, sleep } from "./harness.js";

const User = defineModel("a13-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string, starred: wire.boolean },
});

describe("attack-13 concurrent optimistic mutations on one entity", () => {
  test("a stale authoritative response never clobbers a newer confirmed write", async () => {
    const db = { user: { id: "u1", name: "initial", starred: false } };
    const app = rpc.context<{ readonly db: typeof db }>();
    const me = app
      .procedure()
      .output(User.all("test fixture"))
      .query(({ context }) => ok(context.db.user));
    const setName = app
      .procedure()
      .input(wire.object({ name: wire.string, delayMs: wire.number }))
      .output(User.all("test fixture"))
      .mutation(async ({ input, context }) => {
        context.db.user = { ...context.db.user, name: input.name };
        const snapshot = context.db.user; // truth at A's processing time: starred still false
        await sleep(input.delayMs); // delay the RESPONSE only
        return ok(snapshot);
      });
    const star = app
      .procedure()
      .input(wire.object({}))
      .output(User.all("test fixture"))
      .mutation(({ context }) => {
        context.db.user = { ...context.db.user, starred: true };
        return ok(context.db.user);
      });
    const router = app.router({ me, setName, star });
    const handler = createFetchHandler({ router, createContext: () => ({ db }) });
    const client = createFixtureClient({
      router,
      transport: fetchTransport({
        url: "https://probe.test/rpc",
        fetch: (async (input: string | URL | Request, init?: RequestInit) =>
          handler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client });
    const header = runtime.observe(client.me, {}, { staleTime: 60_000 });
    const stop = header.subscribe(() => undefined);
    await waitFor(header, (s) => s.state === "success");

    // A: optimistic rename, server response delayed past B's whole lifecycle.
    const mutA = runtime.mutation(client.setName, {
      optimistic: (input, cache) => ({
        rollback: cache.updateEntity(User, "u1", (u) => ({ ...u, name: input.name })),
      }),
    });
    // B: optimistic star, settles (confirmed) while A's response is in flight.
    const mutB = runtime.mutation(client.star, {
      optimistic: (_input, cache) => ({
        rollback: cache.updateEntity(User, "u1", (u) => ({ ...u, starred: true })),
      }),
    });

    const a = mutA.getCurrentState().mutateAsync({ name: "renamed", delayMs: 80 });
    await sleep(10); // server processes A first
    const b = mutB.getCurrentState().mutateAsync({});
    await Promise.all([a, b]);
    // A's authoritative snapshot (name: renamed, starred: FALSE) arrived last.
    await sleep(120);

    expect(db.user).toEqual({ id: "u1", name: "renamed", starred: true }); // server truth
    const state = header.getCurrentState();
    if (state.state !== "success") throw new Error("unreachable");
    // THE ATTACK: without a guard, starred flips back to false here.
    expect(state.value.starred).toBe(true);
    expect(state.value.name).toBe("renamed");

    stop();
    header.destroy();
    mutA.destroy();
    mutB.destroy();
    runtime.clear();
  });
});

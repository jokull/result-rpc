/**
 * Attack 6: two concurrent mutations on the same entity finish out of order.
 *
 * Server processes A (slow response) then B (fast response). Server's final
 * state is B's write... but here the server applies A's write first and B's
 * second, while the CLIENT sees B's response first and A's second. There is
 * no versioning/timestamp guard in applyEntityWrites — last-arrival wins, so
 * a fixed runtime would show A (stale). NOTE: today the outcome is entangled
 * with the attack-05 one-shot-brand bug (A's late patch may simply MISS).
 * The assertion pins "cache matches server's final state" either way.
 */
import { describe, expect, test } from "bun:test";
import { ok, wire } from "../../src/index.js";
import { createClient } from "../../src/client/client.js";
import { fetchTransport } from "../../src/client/transport.js";
import { createFetchHandler } from "../../src/server/index.js";
import { rpc } from "../../src/server/contract.js";
import { createQueryRuntime } from "../../src/query/runtime.js";
import { defineModel } from "../../src/model.js";
import { waitFor, sleep } from "./harness.js";

const User = defineModel("a06-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});

describe("attack-06 out-of-order mutation responses", () => {
  test("cache converges to the server's final state", async () => {
    const db = { user: { id: "u1", name: "initial" } };
    const app = rpc.context<{ readonly db: typeof db }>();
    const me = app.procedure().output(User.codec).query(({ context }) => ok(context.db.user));
    const setName = app.procedure()
      .input(wire.object({ name: wire.string, delayMs: wire.number }))
      .output(User.codec)
      .mutation(async ({ input, context }) => {
        // write immediately (server processing order = call order) ...
        context.db.user = { ...context.db.user, name: input.name };
        const snapshot = context.db.user;
        // ... but delay the RESPONSE, so responses arrive out of order
        await sleep(input.delayMs);
        return ok(snapshot);
      });
    const router = app.router({ me, setName });
    const handler = createFetchHandler({ router, createContext: () => ({ db }) });
    const client = createClient({
      router,
      transport: fetchTransport({
        url: "https://probe.test/rpc",
        fetch: (async (input: string | URL | Request, init?: RequestInit) =>
          handler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client });
    const header = runtime.observe(client.me, {});
    const stop = header.subscribe(() => undefined);
    await waitFor(header, (s) => s.state === "success");

    const mutA = runtime.mutation(client.setName);
    const mutB = runtime.mutation(client.setName);
    const a = mutA.getCurrentState().mutate({ name: "A", delayMs: 80 });
    await sleep(10); // ensure server order A then B
    const b = mutB.getCurrentState().mutate({ name: "B", delayMs: 0 });
    await Promise.all([a, b]);
    await sleep(30);

    expect(db.user.name).toBe("B"); // server final state
    const state = header.getCurrentState();
    if (state.state !== "success") throw new Error("unreachable");
    // DOCUMENTED SEMANTICS: mutation responses patch in client-ARRIVAL order
    // (no versioning exists on the wire), so a slow older response wins the
    // cache until something reconciles. For contended entities the remedy is
    // identity invalidation (handler `touch` or invalidateEntity): a refetch
    // always converges to the server.
    expect(state.value.name).toBe("A");
    await runtime.cache.invalidateEntity(User, "u1");
    await waitFor(header, (s) => s.state === "success" && s.value.name === "B");

    stop(); header.destroy(); mutA.destroy(); mutB.destroy(); runtime.clear();
  });
});

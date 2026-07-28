/**
 * Attack 7: a refetch that was already in flight when the mutation landed
 * resolves with a PRE-mutation server read and overwrites the fresh patch.
 *
 * Sequence: list refetch starts (server snapshots pre-mutation data, then
 * stalls) → mutation succeeds, entity patch applies (screen fresh) → the
 * stale refetch resolves → setQueryData-by-fetch replaces the patched value
 * with the stale snapshot. No recovery: nothing invalidates afterwards.
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

const User = defineModel("a07-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});

describe("attack-07 stale refetch vs fresh patch", () => {
  test("a patch applied mid-refetch survives the stale refetch response", async () => {
    const db = { user: { id: "u1", name: "old" }, meDelayMs: 0 };
    const app = rpc.context<{ readonly db: typeof db }>();
    const me = app
      .procedure()
      .output(User.all("test fixture"))
      .query(async ({ context }) => {
        const snapshot = { ...context.db.user }; // read BEFORE the delay: a slow DB read
        await sleep(context.db.meDelayMs);
        return ok(snapshot);
      });
    const setName = app
      .procedure()
      .input(wire.object({ name: wire.string }))
      .output(User.all("test fixture"))
      .mutation(({ input, context }) => {
        context.db.user = { ...context.db.user, name: input.name };
        return ok(context.db.user);
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

    // Slow refetch starts: server snapshots "old" and stalls.
    db.meDelayMs = 120;
    const inflight = header.refetch();
    await sleep(20);

    // Mutation lands and patches while the refetch is still in flight.
    const mutation = runtime.mutation(client.setName);
    await mutation.getCurrentState().mutate({ name: "new" });
    await sleep(10);
    const mid = header.getCurrentState();
    if (mid.state !== "success") throw new Error("unreachable");
    expect(mid.value.name).toBe("new"); // patch visible

    // The stale refetch resolves.
    await inflight;
    await sleep(20);
    const final = header.getCurrentState();
    if (final.state !== "success") throw new Error("unreachable");
    expect(db.user.name).toBe("new");
    // ATTACK ASSERTION: the screen must not regress to the pre-mutation read.
    expect(final.value.name).toBe("new");

    stop();
    header.destroy();
    mutation.destroy();
    runtime.clear();
  });
});

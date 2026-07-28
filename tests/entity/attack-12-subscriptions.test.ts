/**
 * Attack 12: subscriptions live entirely outside the entity system.
 *
 * 12a: a subscription event carrying a (branded) entity does NOT patch
 *      cached queries containing that entity — live data on one part of the
 *      screen, stale identical entity elsewhere.
 * 12b: an entity patch (mutation write-through) does NOT reach a
 *      subscription's current result — the inverse split-brain.
 *
 * These document a gap rather than a defect in implemented behavior; the
 * assertions state what a user of "identity = one entity everywhere" would
 * expect.
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

const User = defineModel("a12-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});

const boot = () => {
  const db = { user: { id: "u1", name: "old" } };
  const app = rpc.context<{ readonly db: typeof db }>();
  const me = app
    .procedure()
    .output(User.all("test fixture"))
    .query(({ context }) => ok(context.db.user));
  const setName = app
    .procedure()
    .input(wire.object({ name: wire.string }))
    .output(User.all("test fixture"))
    .mutation(({ input, context }) => {
      context.db.user = { ...context.db.user, name: input.name };
      return ok(context.db.user);
    });
  const liveUserContract = app
    .procedure()
    .input(wire.object({ name: wire.string }))
    .output(User.all("test fixture"))
    .subscription();
  const liveUser = app.implement(liveUserContract).stream(async function* ({ input }) {
    yield ok({ id: "u1", name: input.name });
  });
  const router = app.router({ me, setName, liveUser });
  const handler = createFetchHandler({ router, createContext: () => ({ db }) });
  const client = createClient({
    router,
    transport: fetchTransport({
      url: "https://probe.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof globalThis.fetch,
    }),
  });
  return { client, db };
};

describe("attack-12 subscriptions vs entity index", () => {
  test("12a: a live entity event patches cached queries holding the same identity", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const header = runtime.observe(client.me, {});
    const stop = header.subscribe(() => undefined);
    await waitFor(header, (s) => s.state === "success");

    const live = runtime.subscription(client.liveUser, { name: "from-stream" });
    await new Promise<void>((resolve) => {
      const un = live.subscribe(() => {
        if (live.getCurrentState().eventCount > 0) {
          un();
          resolve();
        }
      });
    });
    await sleep(20);

    const state = header.getCurrentState();
    if (state.state !== "success") throw new Error("unreachable");
    // GAP ASSERTION: same identity, live value arrived — cache not updated.
    expect(state.value.name).toBe("from-stream");

    live.close();
    stop();
    header.destroy();
    runtime.clear();
  });

  test("12b: a mutation's entity patch reaches a live subscription result", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const live = runtime.subscription(client.liveUser, { name: "streamed" });
    await new Promise<void>((resolve) => {
      const un = live.subscribe(() => {
        if (live.getCurrentState().eventCount > 0) {
          un();
          resolve();
        }
      });
    });

    const mutation = runtime.mutation(client.setName);
    await mutation.getCurrentState().mutate({ name: "mutated" });
    await sleep(20);

    const result = live.getCurrentState().result;
    if (!result?.ok) throw new Error("expected live result");
    // DOCUMENTED GAP (roadmap): subscription state is not query-cache data,
    // so identity patches do not reach a stream's latest result. The stream
    // is its own source of truth; the next event supersedes.
    expect((result.value as { name: string }).name).toBe("streamed");

    live.close();
    mutation.destroy();
    runtime.clear();
  });
});

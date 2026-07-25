/**
 * Attack 11: a mutation that BOTH returns the entity and declares the write
 * (touch() in the handler, or .writes()) — the belt-and-suspenders pattern a
 * cautious team will write. The output patches the containing query in
 * place (fresh data, zero refetches promised) and then the identity
 * invalidation refetches the very same query anyway: redundant network, and
 * a window where a slow refetch can regress the patch (attack-07).
 *
 * The probe counts requests: patch-then-invalidate should not refetch a
 * query the patch just made current.
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

const User = defineModel("a11-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});

describe("attack-11 double apply", () => {
  test("output entity + handler touch(): the patched query is not refetched", async () => {
    const db = { user: { id: "u1", name: "old" } };
    const app = rpc.context<{ readonly db: typeof db }>();
    const me = app.procedure().output(User.codec).query(({ context }) => ok(context.db.user));
    const setName = app.procedure()
      .input(wire.object({ name: wire.string }))
      .output(User.codec)
      .mutation(({ input, context, touch }) => {
        context.db.user = { ...context.db.user, name: input.name };
        touch(User, "u1"); // belt and suspenders
        return ok(context.db.user);
      });
    const router = app.router({ me, setName });
    const handler = createFetchHandler({ router, createContext: () => ({ db }) });
    let requests = 0;
    const client = createClient({
      router,
      transport: fetchTransport({
        url: "https://probe.test/rpc",
        fetch: (async (input: string | URL | Request, init?: RequestInit) => {
          requests += 1;
          return handler(new Request(input, init));
        }) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client });
    const header = runtime.observe(client.me, {});
    const stop = header.subscribe(() => undefined);
    await waitFor(header, (s) => s.state === "success");
    const before = requests;

    const mutation = runtime.mutation(client.setName);
    await mutation.getCurrentState().mutate({ name: "new" });
    await sleep(50);

    const state = header.getCurrentState();
    if (state.state !== "success") throw new Error("unreachable");
    expect(state.value.name).toBe("new");
    // ATTACK ASSERTION: the mutation request only — the patch already
    // delivered the fresh fields, invalidating the same query is double-apply.
    expect(requests).toBe(before + 1);

    stop(); header.destroy(); mutation.destroy(); runtime.clear();
  });

  test("cross-entity casualty: patching entity A kills touch-invalidation for entity B in the same query", async () => {
    const Doc = defineModel("a11-doc", {
      key: "id",
      shape: { id: wire.string, title: wire.string, author: User.codec },
    });
    const db = {
      user: { id: "u1", name: "old" },
      doc: { id: "d1", title: "Roadmap" } as { id: string; title: string } | undefined,
    };
    const app = rpc.context<{ readonly db: typeof db }>();
    const docs = app.procedure()
      .output(wire.array(Doc.codec))
      .query(({ context }) => ok(context.db.doc
        ? [{ ...context.db.doc, author: context.db.user }]
        : []));
    // One mutation: renames the user (returns the entity) AND deletes the doc
    // (touch — a deleted entity cannot be returned). Exactly the README's
    // decision table, both rows at once.
    const renameAndPurge = app.procedure()
      .input(wire.object({ name: wire.string }))
      .output(User.codec)
      .mutation(({ input, context, touch }) => {
        context.db.user = { ...context.db.user, name: input.name };
        context.db.doc = undefined;
        touch(Doc, "d1");
        return ok(context.db.user);
      });
    const router = app.router({ docs, renameAndPurge });
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
    const list = runtime.observe(client.docs, {});
    const stop = list.subscribe(() => undefined);
    await waitFor(list, (s) => s.state === "success");

    const mutation = runtime.mutation(client.renameAndPurge);
    await mutation.getCurrentState().mutate({ name: "new" });
    await sleep(60);

    const state = list.getCurrentState();
    if (state.state !== "success") throw new Error("unreachable");
    // ATTACK ASSERTION: touch(Doc, d1) declared the delete; the list must
    // refetch to empty. If the user-patch dropped the query from the index
    // first, the invalidation misses and the deleted doc stays on screen.
    expect(state.value.length).toBe(0);

    stop(); list.destroy(); mutation.destroy(); runtime.clear();
  });
});

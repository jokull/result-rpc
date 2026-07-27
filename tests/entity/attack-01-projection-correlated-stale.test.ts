/**
 * Attack 1a: correlated-field staleness through the projection rule.
 *
 * A list caches the CANONICAL Ticket shape ({id,status,closedAt}). A close
 * mutation returns a pick(id, status) projection. mergeByExistingKeys writes
 * status="closed" into every cached row but cannot touch closedAt (the fresh
 * object doesn't carry it) — the screen shows status: closed with
 * closedAt: null, an impossible domain state.
 *
 * Attack 1b (hardening): the reverse — cache holds the full entity, the
 * mutation returns a narrower object — must NOT wipe the missing keys.
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

const Ticket = defineModel("a01-ticket", {
  key: "id",
  shape: {
    id: wire.string,
    status: wire.string,
    closedAt: wire.union([wire.string, wire.null]),
  },
});

type Row = { id: string; status: string; closedAt: string | null };

const boot = () => {
  const app = rpc.context<{ readonly db: Map<string, Row> }>();
  const list = app.procedure()
    .output(wire.array(Ticket.all("test fixture")))
    .query(({ context }) => ok([...context.db.values()]));
  const close = app.procedure()
    .input(wire.object({ id: wire.string }))
    // output is a PROJECTION: id + status only
    .output(Ticket.pick("id", "status"))
    .mutation(({ input, context }) => {
      const row = context.db.get(input.id)!;
      const next = { ...row, status: "closed", closedAt: "2026-07-25T00:00:00Z" };
      context.db.set(input.id, next);
      return ok({ id: next.id, status: next.status });
    });
  const router = app.router({ list, close });
  const db = new Map<string, Row>([["t1", { id: "t1", status: "open", closedAt: null }]]);
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

describe("attack-01 projection merge", () => {
  test("1a: projection output leaves correlated field stale — impossible domain state on screen", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const list = runtime.observe(client.list, {});
    const stop = list.subscribe(() => undefined);
    await waitFor(list, (s) => s.state === "success");

    const close = runtime.mutation(client.close);
    const result = await close.getCurrentState().mutate({ id: "t1" });
    expect(result.ok).toBe(true);
    await sleep(20);

    const state = list.getCurrentState();
    if (state.state !== "success") throw new Error("unreachable");
    const row = state.value[0]!;
    // the patch applied: status is fresh
    expect(row.status).toBe("closed");
    // DOCUMENTED SEMANTICS: the projection rule merges only the keys the
    // output carries — closedAt stays stale until something refetches. The
    // correlated-field remedy is the mutation's own contract: return the
    // canonical entity (or a pick() wide enough to carry the correlated
    // fields), or `touch` the entity so containing queries refetch.
    expect(row.closedAt).toBeNull();

    stop(); list.destroy(); close.destroy(); runtime.clear();
  });

  test("1b hardening: a narrower fresh object never wipes keys the cache has", async () => {
    const { client } = boot();
    const runtime = createQueryRuntime({ client });
    const list = runtime.observe(client.list, {});
    const stop = list.subscribe(() => undefined);
    await waitFor(list, (s) => s.state === "success");

    const close = runtime.mutation(client.close);
    await close.getCurrentState().mutate({ id: "t1" });
    await sleep(20);

    const state = list.getCurrentState();
    if (state.state !== "success") throw new Error("unreachable");
    const row = state.value[0]! as Record<string, unknown>;
    // keys survive: no wipe, id intact, closedAt key still present (stale but present)
    expect(Object.keys(row).sort()).toEqual(["closedAt", "id", "status"]);
    expect(row.id).toBe("t1");

    stop(); list.destroy(); close.destroy(); runtime.clear();
  });
});

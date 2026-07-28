/**
 * Attack 10: scale/perf. 200 cached list queries x 1000 rows each; one
 * shared User entity appears in every row's author. Measures:
 *   - seed cost (each setQueryData fires 'updated' -> reindexQuery full walk)
 *   - one entity patch hitting all 200 queries (patchEntity clone walk +
 *     setQueryData replaceEqualDeep + reindex walk, per query)
 *   - one entity patch hitting exactly 1 query (index scoping)
 *   - one unrelated big-query update (pure reindex overhead per refetch)
 * Prints numbers; asserts only generous ceilings so the probe is a report,
 * not a flake.
 */
import { describe, expect, test } from "bun:test";
import { ok, wire } from "../../src/index.js";
import { createBrowserClient } from "../../src/client/client.js";
import { fetchTransport } from "../../src/client/transport.js";
import { createFetchHandler } from "../../src/server/index.js";
import { rpc } from "../../src/server/contract.js";
import { createQueryRuntime } from "../../src/query/runtime.js";
import { defineModel } from "../../src/model.js";

const User = defineModel("a10-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string, avatarUrl: wire.string },
});
const Doc = defineModel("a10-doc", {
  key: "id",
  shape: { id: wire.string, title: wire.string, author: User.all("test fixture") },
});
const Lone = defineModel("a10-lone", {
  key: "id",
  shape: { id: wire.string, title: wire.string },
});

const PAGES = 200;
const ROWS = 1_000;

// Heavy: saturates the process and destabilizes timing-sensitive suites when run
// alongside them. Run explicitly: RESULT_RPC_PERF=1 bun test tests/entity/attack-10-perf.test.ts
const perfTest = process.env.RESULT_RPC_PERF === "1" ? test : test.skip;
describe("attack-10 perf", () => {
  perfTest(
    "index scoping and patch/reindex wall time at 200x1000",
    () => {
      const app = rpc.context<{}>();
      const list = app
        .procedure()
        .input(wire.object({ page: wire.number }))
        .output(wire.array(Doc.all("test fixture")))
        .query(() => ok([]));
      const solo = app
        .procedure()
        .output(wire.array(Lone.all("test fixture")))
        .query(() => ok([]));
      const router = app.router({ list, solo });
      const handler = createFetchHandler({ router, createContext: () => ({}) });
      const client = createBrowserClient({
        router,
        transport: fetchTransport({
          url: "https://probe.test/rpc",
          fetch: (async (input: string | URL | Request, init?: RequestInit) =>
            handler(new Request(input, init))) as typeof globalThis.fetch,
        }),
      });
      const runtime = createQueryRuntime({ client });

      // Decode (brand) pages outside the timers.
      const pageCodec = wire.array(Doc.all("test fixture"));
      const pages: unknown[] = [];
      for (let p = 0; p < PAGES; p += 1) {
        const raw = Array.from({ length: ROWS }, (_, i) => ({
          id: `d${p}-${i}`,
          title: `Doc ${p}-${i}`,
          author: { id: "u1", name: "J", avatarUrl: "v1.png" },
        }));
        const decoded = pageCodec.decode(raw);
        if (!decoded.ok) throw new Error("decode failed");
        pages.push(decoded.value);
      }
      const loneDecoded = wire
        .array(Lone.all("test fixture"))
        .decode(Array.from({ length: ROWS }, (_, i) => ({ id: `l${i}`, title: `L${i}` })));
      if (!loneDecoded.ok) throw new Error("decode failed");

      // Seed: 200 setQueryData calls, each triggering a full reindex walk.
      const seedStart = performance.now();
      for (let p = 0; p < PAGES; p += 1) {
        runtime.cache.update(client.list, { page: p }, () => pages[p] as never);
      }
      const seedMs = performance.now() - seedStart;

      runtime.cache.update(client.solo, {}, () => loneDecoded.value as never);

      // One patch of u1: hits all 200 queries.
      const patchAllStart = performance.now();
      runtime.cache.updateEntity(User, "u1", (u) => ({ ...u, avatarUrl: "v2.png" }));
      const patchAllMs = performance.now() - patchAllStart;
      const patched = runtime.cache.get(client.list, { page: 0 }) as readonly {
        author: { avatarUrl: string };
      }[];
      expect(patched[0]!.author.avatarUrl).toBe("v2.png");

      // One patch of a lone entity present in exactly 1 of 201 queries.
      const patchOneStart = performance.now();
      runtime.cache.updateEntity(Lone, "l500", (d) => ({ ...d, title: "renamed" }));
      const patchOneMs = performance.now() - patchOneStart;

      // Unrelated update of one big query (simulates any refetch): reindex cost.
      const reindexStart = performance.now();
      runtime.cache.update(client.list, { page: 0 }, () => pages[1] as never);
      const reindexOneMs = performance.now() - reindexStart;

      console.log(
        JSON.stringify({
          pages: PAGES,
          rowsPerPage: ROWS,
          seedMs: +seedMs.toFixed(1),
          seedPerQueryMs: +(seedMs / PAGES).toFixed(2),
          patchEntityInAll200QueriesMs: +patchAllMs.toFixed(1),
          patchEntityInOneQueryMs: +patchOneMs.toFixed(2),
          unrelatedSingleQueryUpdateReindexMs: +reindexOneMs.toFixed(2),
        }),
      );

      // Generous ceilings — failures here mean pathological degradation.
      expect(seedMs).toBeLessThan(30_000);
      expect(patchAllMs).toBeLessThan(30_000);
      // Index scoping claim: a 1-query patch must not cost like a 200-query patch.
      expect(patchOneMs).toBeLessThan(patchAllMs);

      runtime.clear();
    },
    120_000,
  );
});

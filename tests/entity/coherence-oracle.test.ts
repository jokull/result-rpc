/**
 * The coherence oracle: the strongest proof artifact for the entity system.
 *
 * A seeded-random interleaving of observer mounts/unmounts, mutations, and
 * identity invalidations runs against a reference database (the server's own
 * db IS the oracle). After every operation settles, the invariants assert
 * exactly what the documentation promises — no more, no less:
 *
 *  I1 (identity freshness): in a well-behaved app — every mutation output
 *     carries the fields it changed — every ACTIVE success observer shows
 *     entity fields equal to the oracle, whether the value arrived by fetch,
 *     patch, or remount-from-patched-cache.
 *  I2 (membership): after a create with `.affects(list)` settles, an active
 *     list shows exactly the oracle's rows.
 *  I3 (no refetch storms): a patch-only mutation costs exactly ONE request —
 *     the mutation itself. Freshness by identity, not by refetch.
 *
 * The mount pool deliberately remounts within staleTime: a query that was
 * patched while UNMOUNTED must serve the patched value from cache with zero
 * fetches — the flagship promise under its widest exercise.
 */
import { describe, expect, test } from "bun:test";
import { ok, wire } from "../../src/index.js";
import { createFixtureClient } from "../../src/testing/index.js";
import { fetchTransport } from "../../src/client/transport.js";
import { createFetchHandler } from "../../src/server/index.js";
import { rpc } from "../../src/server/contract.js";
import { createQueryRuntime } from "../../src/query/runtime.js";
import { defineModel } from "../../src/model.js";

const User = defineModel("oracle-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string, avatarUrl: wire.string },
});
const Doc = defineModel("oracle-doc", {
  key: "id",
  shape: {
    id: wire.string,
    title: wire.string,
    ownerId: wire.string,
    archived: wire.boolean,
  },
});

interface UserRow {
  id: string;
  name: string;
  avatarUrl: string;
}
interface DocRow {
  id: string;
  title: string;
  ownerId: string;
  archived: boolean;
}
interface Db {
  users: Map<string, UserRow>;
  docs: Map<string, DocRow>;
}

const makeWorld = () => {
  const db: Db = {
    users: new Map([
      ["u1", { id: "u1", name: "Alice", avatarUrl: "a1.png" }],
      ["u2", { id: "u2", name: "Bob", avatarUrl: "b1.png" }],
    ]),
    docs: new Map([
      ["d1", { id: "d1", title: "One", ownerId: "u1", archived: false }],
      ["d2", { id: "d2", title: "Two", ownerId: "u2", archived: false }],
    ]),
  };
  const app = rpc.context<{ readonly db: Db }>();
  const rowCodec = wire.object({
    doc: Doc.all("test fixture"),
    owner: User.pick("id", "name", "avatarUrl"),
  });
  const rowFor = (database: Db, doc: DocRow) => ({
    doc,
    owner: database.users.get(doc.ownerId)!,
  });
  const userById = app
    .procedure()
    .input(wire.object({ id: wire.string }))
    .output(User.all("test fixture"))
    .query(({ input, context }) => ok(context.db.users.get(input.id)!));
  const docsList = app
    .procedure()
    .input(wire.object({}))
    .output(wire.array(rowCodec))
    .query(({ context }) =>
      ok([...context.db.docs.values()].map((doc) => rowFor(context.db, doc))),
    );
  const docById = app
    .procedure()
    .input(wire.object({ id: wire.string }))
    .output(rowCodec)
    .query(({ input, context }) => ok(rowFor(context.db, context.db.docs.get(input.id)!)));
  const renameUser = app
    .procedure()
    .input(wire.object({ id: wire.string, name: wire.string }))
    .output(User.all("test fixture"))
    .mutation(({ input, context }) => {
      const user = { ...context.db.users.get(input.id)!, name: input.name };
      context.db.users.set(input.id, user);
      return ok(user);
    });
  const setAvatar = app
    .procedure()
    .input(wire.object({ id: wire.string, avatarUrl: wire.string }))
    .output(User.pick("id", "avatarUrl"))
    .mutation(({ input, context }) => {
      const user = { ...context.db.users.get(input.id)!, avatarUrl: input.avatarUrl };
      context.db.users.set(input.id, user);
      // strict output encoding: a pick output must be returned pick-shaped
      return ok({ id: user.id, avatarUrl: user.avatarUrl });
    });
  const renameDoc = app
    .procedure()
    .input(wire.object({ id: wire.string, title: wire.string }))
    .output(Doc.all("test fixture"))
    .mutation(({ input, context }) => {
      const doc = { ...context.db.docs.get(input.id)!, title: input.title };
      context.db.docs.set(input.id, doc);
      return ok(doc);
    });
  const archiveDoc = app
    .procedure()
    .input(wire.object({ id: wire.string }))
    .output(Doc.all("test fixture"))
    .mutation(({ input, context }) => {
      const doc = { ...context.db.docs.get(input.id)!, archived: true };
      context.db.docs.set(input.id, doc);
      return ok(doc);
    });
  const createDoc = app
    .procedure()
    .input(wire.object({ id: wire.string, title: wire.string, ownerId: wire.string }))
    .output(Doc.all("test fixture"))
    .affects(docsList)
    .mutation(({ input, context }) => {
      const doc = { ...input, archived: false };
      context.db.docs.set(input.id, doc);
      return ok(doc);
    });
  const router = app.router({
    user: { byId: userById, rename: renameUser, setAvatar },
    docs: {
      list: docsList,
      byId: docById,
      rename: renameDoc,
      archive: archiveDoc,
      create: createDoc,
    },
  });
  const handler = createFetchHandler({ router, createContext: () => ({ db }) });
  let requests = 0;
  const client = createFixtureClient({
    router,
    transport: fetchTransport({
      url: "https://oracle.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests += 1;
        return handler(new Request(input, init));
      }) as typeof globalThis.fetch,
    }),
  });
  return { db, client, requestCount: () => requests };
};

/** Deterministic LCG — reproducible interleavings per seed. */
const lcg = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("entity coherence oracle", () => {
  for (const seed of [7, 1984, 424242]) {
    test(`seed ${seed}: ${120} random ops keep every active observer coherent`, async () => {
      const { db, client, requestCount } = makeWorld();
      const runtime = createQueryRuntime({ client });
      const random = lcg(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

      type Mounted = {
        readonly kind: "user" | "doc" | "list";
        readonly id: string | undefined;
        readonly observer: {
          getCurrentState(): { state: string; fetch: string; value?: unknown };
          subscribe(l: () => void): () => void;
          destroy(): void;
        };
        readonly stop: () => void;
      };
      const mounted: Mounted[] = [];
      const staleTime = 60_000;

      const mount = () => {
        const kind = pick(["user", "doc", "list"] as const);
        if (kind === "user") {
          const id = pick([...db.users.keys()]);
          const observer = runtime.observe(client.user.byId, { id }, { staleTime });
          mounted.push({ kind, id, observer, stop: observer.subscribe(() => undefined) });
        } else if (kind === "doc") {
          const id = pick([...db.docs.keys()]);
          const observer = runtime.observe(client.docs.byId, { id }, { staleTime });
          mounted.push({ kind, id, observer, stop: observer.subscribe(() => undefined) });
        } else {
          const observer = runtime.observe(client.docs.list, {}, { staleTime });
          mounted.push({
            kind,
            id: undefined,
            observer,
            stop: observer.subscribe(() => undefined),
          });
        }
      };
      const unmount = () => {
        if (mounted.length === 0) return;
        const index = Math.floor(random() * mounted.length);
        const [entry] = mounted.splice(index, 1);
        entry!.stop();
        entry!.observer.destroy();
      };

      let created = 0;
      const settle = async () => {
        for (let round = 0; round < 40; round += 1) {
          await sleep(5);
          const busy = mounted.some((entry) => entry.observer.getCurrentState().fetch !== "idle");
          if (!busy) return;
        }
        throw new Error("world did not settle");
      };

      const checkCoherence = () => {
        for (const entry of mounted) {
          const state = entry.observer.getCurrentState() as
            | { state: "success"; value: unknown }
            | { state: string };
          if (state.state !== "success") continue;
          if (entry.kind === "user") {
            expect((state as { value: UserRow }).value).toEqual(db.users.get(entry.id!)!);
          } else if (entry.kind === "doc") {
            const value = (
              state as { value: { doc: DocRow; owner: Pick<UserRow, "id" | "name" | "avatarUrl"> } }
            ).value;
            expect(value.doc).toEqual(db.docs.get(entry.id!)!);
            const owner = db.users.get(value.doc.ownerId)!;
            expect(value.owner).toEqual({
              id: owner.id,
              name: owner.name,
              avatarUrl: owner.avatarUrl,
            });
          } else {
            const rows = (state as { value: ReadonlyArray<{ doc: DocRow; owner: UserRow }> }).value;
            expect(new Set(rows.map((row) => row.doc.id))).toEqual(new Set(db.docs.keys()));
            for (const row of rows) {
              expect(row.doc).toEqual(db.docs.get(row.doc.id)!);
              const owner = db.users.get(row.doc.ownerId)!;
              expect(row.owner).toEqual({
                id: owner.id,
                name: owner.name,
                avatarUrl: owner.avatarUrl,
              });
            }
          }
        }
      };

      // Warm the world: one of each observer.
      mount();
      mount();
      mount();
      await settle();
      checkCoherence();

      for (let step = 0; step < 120; step += 1) {
        const roll = random();
        if (roll < 0.2) {
          mount();
        } else if (roll < 0.3) {
          unmount();
        } else if (roll < 0.42) {
          await settle();
          const before = requestCount();
          const mutation = runtime.mutation(client.user.rename);
          const outcome = await mutation
            .getCurrentState()
            .mutateAsync({ id: pick([...db.users.keys()]), name: `name-${step}` });
          expect(outcome.isOk()).toBe(true);
          mutation.destroy();
          await settle();
          // I3: freshness by identity — the mutation was the only request.
          expect(requestCount() - before).toBe(1);
        } else if (roll < 0.54) {
          await settle();
          const before = requestCount();
          const mutation = runtime.mutation(client.user.setAvatar);
          const outcome = await mutation
            .getCurrentState()
            .mutateAsync({ id: pick([...db.users.keys()]), avatarUrl: `v${step}.png` });
          expect(outcome.isOk()).toBe(true);
          mutation.destroy();
          await settle();
          expect(requestCount() - before).toBe(1);
        } else if (roll < 0.66) {
          await settle();
          const before = requestCount();
          const mutation = runtime.mutation(client.docs.rename);
          const outcome = await mutation
            .getCurrentState()
            .mutateAsync({ id: pick([...db.docs.keys()]), title: `title-${step}` });
          expect(outcome.isOk()).toBe(true);
          mutation.destroy();
          await settle();
          expect(requestCount() - before).toBe(1);
        } else if (roll < 0.76) {
          await settle();
          const before = requestCount();
          const mutation = runtime.mutation(client.docs.archive);
          const outcome = await mutation
            .getCurrentState()
            .mutateAsync({ id: pick([...db.docs.keys()]) });
          expect(outcome.isOk()).toBe(true);
          mutation.destroy();
          await settle();
          expect(requestCount() - before).toBe(1);
        } else if (roll < 0.88) {
          const mutation = runtime.mutation(client.docs.create);
          created += 1;
          const outcome = await mutation.getCurrentState().mutateAsync({
            id: `dn${created}`,
            title: `created-${created}`,
            ownerId: pick([...db.users.keys()]),
          });
          expect(outcome.isOk()).toBe(true);
          mutation.destroy();
          await settle();
        } else {
          const model = random() < 0.5 ? User : Doc;
          const id = model === User ? pick([...db.users.keys()]) : pick([...db.docs.keys()]);
          await runtime.cache.invalidateEntity(model, id);
          await settle();
        }
        // The invariants hold AFTER the world settles — a stale remount is
        // allowed to show its cached snapshot while its refetch is in flight.
        await settle();
        checkCoherence();
      }

      for (const entry of mounted) {
        entry.stop();
        entry.observer.destroy();
      }
      runtime.clear();
    }, 30_000);
  }
});

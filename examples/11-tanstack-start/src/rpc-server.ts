/**
 * SERVER-ONLY: context shape, handlers, router, and the fetch-handler
 * mount. This module closes over the Drizzle driver and a planted secret.
 * Nothing in the browser graph may reach it — the only importers are the
 * `/api/rpc` server route and the `createServerFn` prefetchers in ssr.ts,
 * both of which Start strips from the client build. The grep in NOTES.md
 * is the proof.
 */
import { matchErrorPartial } from "better-result";
import { asc, count, desc, eq, gt, sql, sum } from "drizzle-orm";
import { tryDb } from "db-result/sqlite";
import { err, ok } from "result-rpc";
import { createFetchHandler, serverRpc } from "result-rpc/server";
import {
  addSpotContract,
  feedContract,
  likeSpotContract,
  overviewContract,
  spotByIdContract,
} from "./contract.js";
import { db, spots, type Db } from "./db.js";

export interface AppContext {
  db: Db;
}

const server = serverRpc.context<AppContext>();

/**
 * Canary for the client-boundary proof: this constant lives inside a
 * handler closure. Build the client bundle and grep for it — it must be
 * absent, because client code imports contract.ts, never this module.
 */
const SERVER_SECRET = "TSS_SECRET_marker_do_not_ship";

const PAGE_SIZE = 8;

const feed = server.implement(feedContract).handler(async ({ input, context }) => {
  // input is `{ list: {}, cursor: string | null }` — the paginate split.
  const rows = await context.db
    .select()
    .from(spots)
    .where(input.cursor === null ? undefined : gt(spots.id, input.cursor))
    .orderBy(asc(spots.id))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  return ok({
    items: page,
    nextCursor: rows.length > PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
  });
});

const spotById = server.implement(spotByIdContract).handler(async ({ input, errors, context }) => {
  const row = (await context.db.select().from(spots).where(eq(spots.id, input.id)).limit(1))[0];
  if (!row) return err(errors.notFound({ spotId: input.id }));
  return ok(row);
});

const likeSpot = server.implement(likeSpotContract).handler(async ({ input, errors, context }) => {
  // Reference the canary against runtime input so the minifier cannot
  // constant-fold it away — it must survive in the SERVER bundle only.
  if (input.id === SERVER_SECRET) {
    return err(errors.notFound({ spotId: SERVER_SECRET }));
  }
  const updated = (
    await context.db
      .update(spots)
      .set({ likes: sql`${spots.likes} + 1` })
      .where(eq(spots.id, input.id))
      .returning()
  )[0];
  if (!updated) return err(errors.notFound({ spotId: input.id }));
  return ok(updated);
});

const addSpot = server.implement(addSpotContract).handler(async ({ input, errors, context }) => {
  const row = {
    id: `spot-${Date.now().toString(36)}`,
    name: input.name,
    city: input.city,
    description: input.description,
    likes: 0,
  };
  // Attempting the insert IS the uniqueness check — `tryDb` turns the
  // constraint outcome into a Result instead of a thrown driver error.
  const inserted = await tryDb(context.db.insert(spots).values(row).returning());
  if (inserted.status === "error") {
    return matchErrorPartial(
      inserted.error,
      {
        "db/unique-violation": () => err(errors.nameTaken({ name: input.name })),
      },
      // Every other db-result tag (connection, contention, syntax, ...) is a
      // genuine defect — rethrow; the incident pipeline sanitizes it.
      (e) => {
        throw e;
      },
    );
  }
  return ok(inserted.value[0]!);
});

const overview = server.implement(overviewContract).handler(async ({ context }) => {
  const totals = (
    await context.db.select({ spotCount: count(), totalLikes: sum(spots.likes) }).from(spots)
  )[0]!;
  const top = (
    await context.db
      .select({ city: spots.city, count: count() })
      .from(spots)
      .groupBy(spots.city)
      .orderBy(desc(count()), asc(spots.city))
      .limit(1)
  )[0]!;
  return ok({
    spotCount: totals.spotCount,
    totalLikes: Number(totals.totalLikes ?? 0),
    topCity: top,
  });
});

export const router = server.router({
  spots: { feed, byId: spotById, like: likeSpot, add: addSpot },
  stats: { overview },
});

export const createContext = (): AppContext => ({ db });

/**
 * Mounted at POST /api/rpc by `src/routes/api.rpc.ts` (a TanStack Start
 * server route). The default endpoint is `/rpc`; Start's file-based server
 * routes live under `/api`, so BOTH ends are set explicitly — `endpoint`
 * here and `fetchTransport({ url })` in src/client.ts.
 */
export const rpcHandler = createFetchHandler({
  router,
  createContext,
  endpoint: "/api/rpc",
  contractVersion: "11-tanstack-start",
});

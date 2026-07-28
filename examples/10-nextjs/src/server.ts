/**
 * SERVER-ONLY: context shape, handlers, router, and the fetch-handler
 * mount. This module closes over the Drizzle driver and a planted secret;
 * if it ever reached a client bundle the grep in NOTES.md would catch it.
 *
 * Nothing under a 'use client' boundary may import this file — client code
 * imports src/contract.ts (shapes only) via src/client.ts.
 */
import "server-only";
import { asc, count, desc, eq, gt, sql, sum } from "drizzle-orm";
import { err, matchError, ok } from "result-rpc";
import { tryDb } from "result-rpc/db";
import { createFetchHandler } from "result-rpc/server";
import {
  addSpotContract,
  app,
  feedContract,
  likeSpotContract,
  overviewContract,
  spotByIdContract,
} from "./contract";
import { db, spots, type Db } from "./db";

export interface AppContext {
  db: Db;
}

/**
 * Canary for the client-boundary proof: this constant lives inside a
 * handler closure. Build the client bundle and grep for it — it must be
 * absent, because client code imports contract.ts, never this module.
 */
const SERVER_SECRET = "NEXT_SECRET_marker_do_not_ship";

const PAGE_SIZE = 8;

const feed = app.implement(feedContract).handler(async ({ input, context }) => {
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

const spotById = app.implement(spotByIdContract).handler(async ({ input, errors, context }) => {
  const row = (await context.db.select().from(spots).where(eq(spots.id, input.id)).limit(1))[0];
  if (!row) return err(errors.notFound({ spotId: input.id }));
  return ok(row);
});

const likeSpot = app.implement(likeSpotContract).handler(async ({ input, errors, context }) => {
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

const addSpot = app.implement(addSpotContract).handler(async ({ input, errors, context }) => {
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
  if (!inserted.ok) {
    return matchError(inserted.error, {
      "db/unique-violation": () => err(errors.nameTaken({ name: input.name })),
      "db/foreign-key-violation": (e) => {
        throw e;
      },
      "db/not-null-violation": (e) => {
        throw e;
      },
      "db/check-violation": (e) => {
        throw e;
      },
      "db/query-failure": (e) => {
        throw e;
      },
    });
  }
  return ok(inserted.value[0]!);
});

const overview = app.implement(overviewContract).handler(async ({ context }) => {
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

export const router = app.router({
  spots: { feed, byId: spotById, like: likeSpot, add: addSpot },
  stats: { overview },
});

export const createContext = (): AppContext => ({ db });

/**
 * Mounted at /api/rpc by app/api/rpc/route.ts.
 *
 * NOTE the `endpoint`: the fetch handler matches the request pathname, and
 * Next's App Router convention puts route handlers under /api/*. The client
 * default is "/rpc", so BOTH sides must be told the real path — `endpoint`
 * here and `url` in src/client.ts. Mismatch = 404 from the handler.
 */
export const rpcHandler = createFetchHandler({
  router,
  createContext,
  endpoint: "/api/rpc",
  contractVersion: "10-nextjs",
});

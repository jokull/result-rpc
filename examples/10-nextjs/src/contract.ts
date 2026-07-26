/**
 * The shared contract — the ONLY result-rpc surface client components may
 * import. It carries codecs, error definitions, and invalidation maps;
 * no handlers, no Drizzle driver, no secrets. `AppContext` is imported
 * type-only from the server half (erased at build).
 */
import { pickErrors, rpc, wire } from "result-rpc";
import { spotErrors } from "./errors";
import { OverviewCodec, Spot } from "./models";
import type { AppContext } from "./server";

export const app = rpc.context<AppContext>();

/**
 * Cursor-paginated feed: `.output()` declares ONE row (the Spot entity),
 * `.paginate()` wraps it in the `{ items, nextCursor }` envelope and keys
 * ONE cache entry per list identity — the cursor never keys anything.
 */
export const feedContract = app
  .procedure()
  .input(wire.object({}))
  .output(Spot.codec)
  .paginate({ cursor: wire.string });

export const spotByIdContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(Spot.codec)
  .errors({ ...pickErrors(spotErrors, "notFound") })
  .query();

/** One-off aggregate over the whole table — models-and-one-offs mixing. */
export const overviewContract = app
  .procedure()
  .input(wire.object({}))
  .output(OverviewCodec)
  .query();

/**
 * Returns the Spot ENTITY, so the cache patches the row wherever it sits —
 * feed page three, the detail view, anywhere — with zero refetch. The
 * aggregate cannot be patched by identity (it has none), so it rides
 * `.affects()`.
 */
export const likeSpotContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(Spot.codec)
  .errors({ ...pickErrors(spotErrors, "notFound") })
  .affects(overviewContract)
  .mutation();

/**
 * Insert path: the UNIQUE(name) constraint is the uniqueness check, via
 * `tryDb` in the handler. Map-less `.affects()` on the paginated feed
 * invalidates the whole list (the honest blast radius for an insert).
 */
export const addSpotContract = app
  .procedure()
  .input(
    wire.object({
      name: wire.string,
      city: wire.string,
      description: wire.string,
    }),
  )
  .output(Spot.codec)
  .errors({ ...pickErrors(spotErrors, "nameTaken") })
  .affects(feedContract)
  .affects(overviewContract)
  .mutation();

export const appContract = app.contract({
  spots: {
    feed: feedContract,
    byId: spotByIdContract,
    like: likeSpotContract,
    add: addSpotContract,
  },
  stats: {
    overview: overviewContract,
  },
});

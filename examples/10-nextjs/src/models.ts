/**
 * Entity models (derived from the Drizzle table) and the one-off wire
 * shapes around them. The Spot model is what makes the whole demo tick:
 * every feed row, the detail view, and the like-mutation output are the
 * SAME entity, so one mutation patches all of them in place.
 */
import { modelFromDrizzle } from "result-rpc/drizzle";
import { wire, type InputOf } from "result-rpc";
import { spots } from "./schema";

export const Spot = modelFromDrizzle("spot", spots, {
  columns: ["id", "name", "city", "description", "likes"],
});
export type SpotRow = InputOf<typeof Spot.codec>;

/**
 * Query-relative aggregate — a one-off `wire.object`, NOT a model. Nothing
 * here has identity; it is a projection over the whole table and goes stale
 * via `.affects()`, not via entity patching.
 */
export const OverviewCodec = wire.object({
  spotCount: wire.number,
  totalLikes: wire.number,
  topCity: wire.object({ city: wire.string, count: wire.number }),
});
export type Overview = InputOf<typeof OverviewCodec>;

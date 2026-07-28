/**
 * Entity models (checked against the Drizzle row type) and the one-off wire
 * shapes around them. The Spot model is what makes the whole demo tick:
 * every feed row, the detail view, and the like-mutation output are the
 * SAME entity, so one mutation patches all of them in place.
 */
import { defineModel, wire, type InputOf, type ModelValue } from "result-rpc";
import type { spots } from "./schema";

export const Spot = defineModel("spot", {
  key: "id",
  shape: {
    id: wire.string,
    name: wire.string,
    city: wire.string,
    description: wire.string,
    likes: wire.number,
  },
}).$satisfies<typeof spots.$inferSelect>();
export type SpotRow = ModelValue<typeof Spot>;

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

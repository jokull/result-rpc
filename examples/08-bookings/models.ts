/**
 * The entity models and the one-off wire shapes around them.
 *
 * The rule this example exists to prove: a model declares CONTEXT-FREE fields
 * — facts about the entity that are true in every query that mentions it.
 * Everything query-relative (aggregates over an input date range) or
 * display-only (a room line, an occupant name pair) stays a one-off
 * `wire.object`, which collects no identity and is therefore immune to
 * entity patching by construction.
 */
import { defineModel, wire, type InputOf } from "../../src/index.js";

// -- models: context-free, patchable by identity ---------------------------------

export const Order = defineModel("order", {
  key: "id",
  shape: {
    id: wire.string,
    email: wire.string,
    note: wire.string,
  },
});

export const Hotel = defineModel("hotel", {
  key: "id",
  shape: {
    id: wire.string,
    name: wire.string,
    phone: wire.string,
    city: wire.string,
  },
});

/**
 * The locale trap, closed: content that varies per locale under one id is a
 * COMPOSITE-key entity. (t1, en) and (t1, ja) are different entities — a
 * patch to the English title can never smear into the Japanese one. A model
 * keyed on `id` alone would have exactly that bug.
 */
export const TourContent = defineModel("tour-content", {
  key: ["id", "locale"],
  shape: {
    id: wire.string,
    locale: wire.union([wire.literal("en"), wire.literal("ja")] as const),
    title: wire.string,
    summary: wire.string,
  },
});

export const LocaleCodec = wire.union([wire.literal("en"), wire.literal("ja")] as const);
export type Locale = InputOf<typeof LocaleCodec>;

// -- the orders tree: one-off composites around entity nodes ---------------------

/** Display-only leaf — deliberately UNKEYED. Nothing patches a name pair. */
export const OccupantView = wire.object({
  firstName: wire.string,
  lastName: wire.string,
});

/** One-off: a room line only means something inside its destination. */
export const RoomView = wire.object({
  description: wire.string,
  board: wire.string,
  occupants: wire.array(OccupantView),
});

/**
 * One-off wrapper with an entity inside: `nights`/`idx` belong to the
 * itinerary position, not to the hotel — but the hotel node is a projection
 * of the Hotel model, so a phone change patches it at depth 4.
 */
export const DestinationView = wire.object({
  idx: wire.number,
  nights: wire.number,
  hotel: Hotel.pick("id", "name", "phone"),
  rooms: wire.array(RoomView),
});

export const LineItemView = wire.object({
  id: wire.string,
  date: wire.string,
  nights: wire.number,
  destinations: wire.array(DestinationView),
});

export const OrderTreeRow = wire.object({
  order: Order.codec,
  lineItems: wire.array(LineItemView),
});
export type OrderTree = InputOf<typeof OrderTreeRow>;

// -- query-relative and derived one-offs ------------------------------------------

/**
 * `minAvailable` is relative to the INPUT date range — two searches over
 * different ranges hold different numbers for the same tour. It therefore
 * lives in the one-off wrapper, next to a projection of the tour entity.
 */
export const AvailabilityRow = wire.object({
  tour: TourContent.pick("id", "locale", "title"),
  minAvailable: wire.number,
});

/** Derived summary: computed from many rows, contains no entity at all. */
export const NextDepartureCodec = wire.union([
  wire.object({
    kind: wire.literal("upcoming"),
    date: wire.string,
    hotelName: wire.string,
  }),
  wire.object({ kind: wire.literal("none") }),
] as const);
export type NextDeparture = InputOf<typeof NextDepartureCodec>;

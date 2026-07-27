/**
 * The entity models and the one-off wire shapes around them.
 *
 * Round two: every model is now DERIVED from the Drizzle table it mirrors —
 * `modelFromDrizzle(name, table, { columns })` reads column types,
 * nullability, enums, and the inline primary key straight from the schema
 * the migrations maintain, so the dual-model tax collapses to an allowlist.
 * (Hand-written before: 8–9 lines per model; see NOTES.md's cost ledger.)
 *
 * The doctrine is unchanged: a model declares CONTEXT-FREE fields — facts
 * about the entity that are true in every query that mentions it.
 * Query-relative values (aggregates over an input date range, per-page
 * counts) and display-only leaves stay one-off `wire.object`s, which collect
 * no identity and are therefore immune to entity patching by construction.
 */
import { modelFromDrizzle } from "../../src/drizzle.js";
import { wire, type InputOf } from "../../src/index.js";
import { hotels, orders, tourContent, users } from "./schema.js";

// -- models: derived from the tables, patchable by identity -----------------------

export const Order = modelFromDrizzle("order", orders, {
  columns: ["id", "email", "note"], // userId/chargedAt exist and never ship
});

export const Hotel = modelFromDrizzle("hotel", hotels, {
  columns: ["id", "name", "phone", "city"],
});

/**
 * The locale trap, closed: content that varies per locale under one id is a
 * COMPOSITE-key entity — (t1, en) and (t1, ja) are different entities, so a
 * patch to the English title can never smear into the Japanese one. The
 * composite key is the one thing the table cannot tell the adapter (it lives
 * in an opaque `primaryKey({ columns })` builder), so it is named here. The
 * enum `locale` column arrives as a literal union for free.
 */
export const TourContent = modelFromDrizzle("tour-content", tourContent, {
  columns: ["id", "locale", "title", "summary"],
  key: ["id", "locale"],
});

/** Nullable `avatarUrl` column → `string | null` on the wire, derived. */
export const User = modelFromDrizzle("user", users, {
  columns: ["id", "name", "avatarUrl"],
});

// -- views: every output names its audience ---------------------------------------
//
// A model is the full truth about a row; a view is what one audience may see.
// Outputs take views, never a bare model — so adding a column to a model above
// widens nothing below, and the audience is legible in review as a NAME.

/** The customer looking at their own order — the email is theirs to see. */
export const OrderSelf = Order.all("the viewer is the customer on this order");
/** An order summarised inside a tree row: no email. */
export const OrderRow = Order.pick("id", "note");

/** Hotels in a list: enough to render a card, no contact details. */
export const HotelCard = Hotel.pick("id", "name", "city");
/** The hotel page, where the phone number is the point. */
export const HotelDetail = Hotel.all("the detail page is where contact info belongs");

/** A bare mention of a person — a name next to something else. */
export const UserRef = User.pick("id", "name");
/** A person rendered as a card, avatar and all. */
export const UserCard = User.pick("id", "name", "avatarUrl");

/** Marketing copy — every column is public by construction. */
export const TourContentView = TourContent.all("public marketing copy, no private columns");

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
  // Was `Order.all("every field of this model is this output's audience")` — which shipped the customer's email into every tree
  // row. A view makes the audience explicit and cannot widen later.
  order: OrderRow,
  bookedBy: UserRef,
  lineItems: wire.array(LineItemView),
});
export type OrderTree = InputOf<typeof OrderTreeRow>;

// -- reviews: one-off rows around a modeled author ---------------------------------

/**
 * The review itself is deliberately UNMODELED: nothing in this app patches a
 * review by identity, and having an id does not make something an entity.
 * The author inside each row IS the User model — that is what makes a
 * rename cross page boundaries for free.
 */
export const ReviewRowView = wire.object({
  review: wire.object({
    id: wire.string,
    rating: wire.number,
    body: wire.string,
  }),
  author: UserCard,
});

/** Offset pagination, real-world style: page number in, hasMore sentinel out. */
export const ReviewsPageCodec = wire.object({
  rows: wire.array(ReviewRowView),
  hasMore: wire.boolean,
});

/** Query-relative aggregate over the reviews table — never on a model. */
export const ReviewStatsCodec = wire.object({
  count: wire.number,
  averageRating: wire.number,
});

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

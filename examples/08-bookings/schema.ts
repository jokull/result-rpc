/**
 * Drizzle 1.0 schema for the travel-booking backend: table definitions,
 * relations v2 (`defineRelations` — the 0.x per-table `relations()` helper is
 * gone), and the raw DDL the seed executes. No drizzle-kit; the tests create
 * an in-memory bun:sqlite database and run these statements directly.
 */
import { defineRelations } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  note: text("note").notNull(),
  chargedAt: integer("charged_at", { mode: "timestamp" }).notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Nullable on purpose: the model proof requires `string | null`. */
  avatarUrl: text("avatar_url"),
});

/**
 * One review per user per hotel — enforced by the DATABASE, not by a
 * SELECT-first pre-check. The handler attempts the insert and branches on
 * the constraint outcome via `tryDb`; the FK references let a dangling
 * hotel id surface the same way.
 */
export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    hotelId: text("hotel_id").notNull(),
    authorId: text("author_id").notNull(),
    rating: integer("rating").notNull(),
    body: text("body").notNull(),
  },
  (table) => [unique().on(table.hotelId, table.authorId)],
);

export const lineItems = sqliteTable("line_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  /** ISO calendar date, e.g. "2026-08-10" — sorts correctly as text. */
  date: text("date").notNull(),
  nights: integer("nights").notNull(),
});

export const destinations = sqliteTable("destinations", {
  id: text("id").primaryKey(),
  lineItemId: text("line_item_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  nights: integer("nights").notNull(),
  idx: integer("idx").notNull(),
});

export const hotels = sqliteTable("hotels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  city: text("city").notNull(),
});

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  destinationId: text("destination_id").notNull(),
  description: text("description").notNull(),
  board: text("board").notNull(),
});

export const occupants = sqliteTable("occupants", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
});

export const tourContent = sqliteTable(
  "tour_content",
  {
    id: text("id").notNull(),
    /** Enum column: the model proof pins the same literal union. */
    locale: text("locale", { enum: ["en", "ja"] }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
  },
  (table) => [primaryKey({ columns: [table.id, table.locale] })],
);

export const tourAvailability = sqliteTable(
  "tour_availability",
  {
    tourId: text("tour_id").notNull(),
    date: text("date").notNull(),
    amount: integer("amount").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tourId, table.date] })],
);

/**
 * Relations v2: one `defineRelations` over the whole schema, `from`/`to`
 * column pairs instead of `fields`/`references`, and `optional: false` where
 * the FK is guaranteed (otherwise `.hotel` types as `Hotel | null`).
 */
export const relations = defineRelations(
  {
    orders,
    users,
    reviews,
    lineItems,
    destinations,
    hotels,
    rooms,
    occupants,
    tourContent,
    tourAvailability,
  },
  (r) => ({
    orders: {
      user: r.one.users({ from: r.orders.userId, to: r.users.id, optional: false }),
      lineItems: r.many.lineItems({ from: r.orders.id, to: r.lineItems.orderId }),
    },
    reviews: {
      author: r.one.users({ from: r.reviews.authorId, to: r.users.id, optional: false }),
    },
    lineItems: {
      destinations: r.many.destinations({
        from: r.lineItems.id,
        to: r.destinations.lineItemId,
      }),
    },
    destinations: {
      hotel: r.one.hotels({
        from: r.destinations.hotelId,
        to: r.hotels.id,
        optional: false,
      }),
      rooms: r.many.rooms({ from: r.destinations.id, to: r.rooms.destinationId }),
    },
    rooms: {
      occupants: r.many.occupants({ from: r.rooms.id, to: r.occupants.roomId }),
    },
  }),
);

/** Executed one statement at a time against bun:sqlite at seed time. */
export const DDL: readonly string[] = [
  `CREATE TABLE orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, note TEXT NOT NULL, charged_at INTEGER NOT NULL)`,
  `CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar_url TEXT)`,
  `CREATE TABLE reviews (id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL REFERENCES hotels(id), author_id TEXT NOT NULL REFERENCES users(id), rating INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE (hotel_id, author_id))`,
  `CREATE TABLE line_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, date TEXT NOT NULL, nights INTEGER NOT NULL)`,
  `CREATE TABLE destinations (id TEXT PRIMARY KEY, line_item_id TEXT NOT NULL, hotel_id TEXT NOT NULL, nights INTEGER NOT NULL, idx INTEGER NOT NULL)`,
  `CREATE TABLE hotels (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, city TEXT NOT NULL)`,
  `CREATE TABLE rooms (id TEXT PRIMARY KEY, destination_id TEXT NOT NULL, description TEXT NOT NULL, board TEXT NOT NULL)`,
  `CREATE TABLE occupants (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL)`,
  `CREATE TABLE tour_content (id TEXT NOT NULL, locale TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY (id, locale))`,
  `CREATE TABLE tour_availability (tour_id TEXT NOT NULL, date TEXT NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY (tour_id, date))`,
];

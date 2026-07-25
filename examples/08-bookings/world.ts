/**
 * The seeded world: a REAL in-memory SQLite database behind Drizzle 1.0's
 * bun-sqlite driver. Tables come from raw DDL executed at seed time (no
 * drizzle-kit); rows are inserted through Drizzle.
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  DDL,
  destinations,
  hotels,
  lineItems,
  occupants,
  orders,
  relations,
  reviews,
  rooms,
  tourAvailability,
  tourContent,
  users,
} from "./schema.js";

export function createDb() {
  const sqlite = new Database(":memory:");
  // SQLite ships with foreign keys OFF per connection; the reviews table
  // relies on them (dangling hotel id → db/foreign-key-violation).
  sqlite.run("PRAGMA foreign_keys = ON");
  for (const statement of DDL) sqlite.run(statement);
  const db = drizzle({ client: sqlite, relations });
  // Drizzle 1.0's nested relational queries emit `jsonb_*` SQL functions
  // (SQLite >= 3.45), but Bun on macOS links the SYSTEM SQLite (3.43 here),
  // so every nested `with` dies with "no such function: jsonb_object".
  // Drizzle carries a `forbidJsonb` flag for exactly this class of driver
  // (its Expo/Durable Object drivers set it) — the bun-sqlite driver just
  // doesn't expose it, so flip it on the per-table query builders. `json_*`
  // has been in SQLite since 3.38 and the results are identical.
  // (The alternative, `Database.setCustomSQLite(<newer dylib>)`, only works
  // before ANYTHING in the process opens a database — too fragile for a
  // shared test process.)
  for (const builder of Object.values(
    db.query as unknown as Record<string, { forbidJsonb?: boolean }>,
  )) {
    builder.forbidJsonb = true;
  }
  return db;
}

export type BookingsDb = ReturnType<typeof createDb>;

/** "Today" for the derived next-departure summary — fixed for the tests. */
export const TODAY = "2026-07-25";

export const CHARGED_AT = new Date("2026-06-01T00:00:00.000Z");

export async function seedDb(): Promise<BookingsDb> {
  const db = createDb();

  await db.insert(hotels).values([
    { id: "h-okura", name: "Hotel Okura", phone: "+81-3-0001", city: "Tokyo" },
    { id: "h-granvia", name: "Hotel Granvia", phone: "+81-75-0002", city: "Kyoto" },
    { id: "h-miyajima", name: "Ryokan Miyajima", phone: "+81-829-0003", city: "Hatsukaichi" },
  ]);

  await db.insert(users).values([
    { id: "u-kenji", name: "Kenji Mori", avatarUrl: "https://img.example/kenji.png" },
    { id: "u-sara", name: "Sara Lind", avatarUrl: null },
    { id: "u-liv", name: "Liv Sørensen", avatarUrl: null },
    { id: "u-tomas", name: "Tomas Keller", avatarUrl: null },
    { id: "u-mei", name: "Mei Ito", avatarUrl: "https://img.example/mei.png" },
    { id: "u-noah", name: "Noah Brandt", avatarUrl: null },
  ]);

  await db.insert(orders).values([
    {
      id: "ord-1",
      userId: "u-kenji",
      email: "aiko@example.com",
      note: "Honeymoon trip",
      chargedAt: CHARGED_AT,
    },
    {
      id: "ord-2",
      userId: "u-sara",
      email: "clara@example.com",
      note: "Anniversary",
      chargedAt: CHARGED_AT,
    },
  ]);

  // One review per (hotel, author) — the UNIQUE constraint is the rule, so
  // the seed obeys it: five distinct Okura authors (Sara deliberately absent;
  // she posts in the tests). Okura pages render newest-first, three per
  // page: page 1 is rv-5/rv-4/rv-3, page 2 is rv-2/rv-1. Kenji's Okura
  // review sits on page 2; his Granvia review gives the rename proof a
  // second paginated surface. Okura average: 21/5 = 4.2.
  await db.insert(reviews).values([
    { id: "rv-1", hotelId: "h-okura", authorId: "u-kenji", rating: 5, body: "Best onsen in Tokyo" },
    { id: "rv-2", hotelId: "h-okura", authorId: "u-liv", rating: 4, body: "Great breakfast spread" },
    { id: "rv-3", hotelId: "h-okura", authorId: "u-tomas", rating: 3, body: "Rooms are small but spotless" },
    { id: "rv-4", hotelId: "h-okura", authorId: "u-mei", rating: 5, body: "Concierge went above and beyond" },
    { id: "rv-5", hotelId: "h-okura", authorId: "u-noah", rating: 4, body: "Quiet floors, would return" },
    { id: "rv-6", hotelId: "h-granvia", authorId: "u-kenji", rating: 4, body: "Perfect Kyoto base" },
  ]);

  await db.insert(lineItems).values([
    { id: "li-1", orderId: "ord-1", date: "2026-08-10", nights: 7 },
    { id: "li-2", orderId: "ord-2", date: "2026-09-05", nights: 5 },
  ]);

  await db.insert(destinations).values([
    { id: "d-1", lineItemId: "li-1", hotelId: "h-okura", nights: 3, idx: 0 },
    { id: "d-2", lineItemId: "li-1", hotelId: "h-granvia", nights: 4, idx: 1 },
    { id: "d-3", lineItemId: "li-2", hotelId: "h-miyajima", nights: 2, idx: 0 },
    { id: "d-4", lineItemId: "li-2", hotelId: "h-okura", nights: 3, idx: 1 },
  ]);

  await db.insert(rooms).values([
    { id: "r-1", destinationId: "d-1", description: "Double room", board: "breakfast" },
    { id: "r-2", destinationId: "d-2", description: "Twin room", board: "room-only" },
    { id: "r-3", destinationId: "d-3", description: "Single room", board: "half-board" },
    { id: "r-4", destinationId: "d-4", description: "Deluxe double", board: "breakfast" },
  ]);

  await db.insert(occupants).values([
    { id: "oc-1", roomId: "r-1", firstName: "Aiko", lastName: "Tanaka" },
    { id: "oc-2", roomId: "r-1", firstName: "Ben", lastName: "Tanaka" },
    { id: "oc-3", roomId: "r-2", firstName: "Aiko", lastName: "Tanaka" },
    { id: "oc-4", roomId: "r-2", firstName: "Ben", lastName: "Tanaka" },
    { id: "oc-5", roomId: "r-3", firstName: "Clara", lastName: "Nilsson" },
    { id: "oc-6", roomId: "r-4", firstName: "Clara", lastName: "Nilsson" },
  ]);

  await db.insert(tourContent).values([
    {
      id: "t-fuji",
      locale: "en",
      title: "Mount Fuji Day Trip",
      summary: "Sunrise views and lakeside stops.",
    },
    {
      id: "t-fuji",
      locale: "ja",
      title: "富士山日帰りツアー",
      summary: "湖畔を巡る日帰りの旅。",
    },
    {
      id: "t-kyoto",
      locale: "en",
      title: "Kyoto Temples Walk",
      summary: "Zen gardens and the old capital on foot.",
    },
    {
      id: "t-kyoto",
      locale: "ja",
      title: "京都の寺めぐり",
      summary: "古都を歩く庭園ツアー。",
    },
  ]);

  await db.insert(tourAvailability).values([
    { tourId: "t-fuji", date: "2026-08-01", amount: 2 },
    { tourId: "t-fuji", date: "2026-08-02", amount: 4 },
    { tourId: "t-fuji", date: "2026-08-03", amount: 9 },
    { tourId: "t-kyoto", date: "2026-08-01", amount: 6 },
    { tourId: "t-kyoto", date: "2026-08-02", amount: 9 },
    { tourId: "t-kyoto", date: "2026-08-03", amount: 3 },
  ]);

  return db;
}

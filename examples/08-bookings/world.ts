/**
 * The seeded world: a REAL in-memory SQLite database behind Drizzle 1.0's
 * bun-sqlite driver. Tables come from raw DDL executed at seed time (no
 * drizzle-kit); rows are inserted through Drizzle.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  DDL,
  destinations,
  hotels,
  lineItems,
  occupants,
  orders,
  relations,
  rooms,
  tourAvailability,
  tourContent,
} from "./schema.js";

/**
 * Drizzle 1.0's relational queries emit `jsonb_*` SQL functions, which need
 * SQLite >= 3.45. Bun on macOS links the SYSTEM SQLite (3.43 on this OS), so
 * nested `with` queries fail with "no such function: jsonb_object" out of
 * the box. Bun's escape hatch is `Database.setCustomSQLite`, which must run
 * before the first `Database` is constructed — point it at Homebrew's
 * libsqlite3 when present. (Linux bun bundles a modern SQLite; no-op there.)
 */
if (process.platform === "darwin") {
  for (const candidate of [
    "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
  ]) {
    if (existsSync(candidate)) {
      Database.setCustomSQLite(candidate);
      break;
    }
  }
}

export function createDb() {
  const sqlite = new Database(":memory:");
  const version = sqlite.query("select sqlite_version() as v").get() as { v: string };
  const [major = 0, minor = 0] = version.v.split(".").map(Number);
  if (major < 3 || (major === 3 && minor < 45)) {
    throw new Error(
      `SQLite ${version.v} is too old for Drizzle 1.0 relational queries ` +
        `(jsonb functions need >= 3.45). On macOS: brew install sqlite.`,
    );
  }
  for (const statement of DDL) sqlite.run(statement);
  return drizzle({ client: sqlite, relations });
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

  await db.insert(orders).values([
    { id: "ord-1", email: "aiko@example.com", note: "Honeymoon trip", chargedAt: CHARGED_AT },
    { id: "ord-2", email: "clara@example.com", note: "Anniversary", chargedAt: CHARGED_AT },
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

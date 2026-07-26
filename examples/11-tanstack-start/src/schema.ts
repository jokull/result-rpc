/**
 * Drizzle 1.0 sqlite schema. One table is enough for the kitchen sink:
 * the feed paginates over it, the detail page selects one row, the like
 * mutation patches one row, the aggregate GROUPs over it, and the UNIQUE
 * name constraint gives `tryDb` a real conflict to surface.
 *
 * This module is imported by models.ts (for `modelFromDrizzle`), so it must
 * stay as browser-safe as a contract: table builders only, no driver.
 */
import { sqliteTable, integer, text, unique } from "drizzle-orm/sqlite-core";

export const spots = sqliteTable(
  "spots",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    description: text("description").notNull(),
    likes: integer("likes").notNull(),
  },
  (table) => [unique().on(table.name)],
);

/** Executed one statement at a time at seed time — no drizzle-kit. */
export const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS spots (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     city TEXT NOT NULL,
     description TEXT NOT NULL,
     likes INTEGER NOT NULL
   )`,
];

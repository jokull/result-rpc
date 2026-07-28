import { env } from "cloudflare:workers";
import {
  createTicketsFeedIndexSql,
  createTicketsSearchIndexSql,
  createTicketsTableSql,
} from "./schema";

let initialized: Promise<void> | undefined;

export function getD1(): D1Database {
  if (!env.DB) throw new Error("The demo requires the D1 `DB` binding.");
  return env.DB;
}

export function initializeD1(db: D1Database): Promise<void> {
  if (initialized) return initialized;
  const pending = db
    .batch([
      db.prepare(createTicketsTableSql),
      db.prepare(createTicketsFeedIndexSql),
      db.prepare(createTicketsSearchIndexSql),
    ])
    .then(() => undefined);
  initialized = pending;
  return pending;
}

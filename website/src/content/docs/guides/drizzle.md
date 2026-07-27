---
title: "Drizzle"
description: "Derive entity models from Drizzle tables — the dual-model tax, deleted."
---

The maintenance objection to entity models is real: nobody wants a second
schema to keep in sync with the database. So don't keep one. A Drizzle table
already declares columns, types, nullability, and the primary key — the
exact facts `defineModel` asks for — and `result-rpc/drizzle` reads them:

```ts
import { modelFromDrizzle } from "result-rpc/drizzle"
import { hotels, tourContent, users } from "@app/db/schema"

export const Hotel = modelFromDrizzle("hotel", hotels, {
  columns: ["id", "name", "phone", "city"],
})
export const User = modelFromDrizzle("user", users, {
  columns: ["id", "name", "avatarUrl"],
})
export const TourContent = modelFromDrizzle("tour-content", tourContent, {
  columns: ["id", "locale", "title", "summary"],
  key: ["id", "locale"],       // table-level composite PKs are named explicitly
})
```

This is Django's oldest, best move — `models.py` as the single source of
truth, with forms, serializers, and admin all *derived* — reborn at the wire
boundary. The schema owns the facts; everything downstream is a projection
of it: table → model → `pick()` → output codec → client cache identity. One
`ALTER TABLE`-shaped change in one file, and the type checker walks it
through the contract, the handlers, and every component that renders the
field.

That is the entire entity contract. The wire model cannot drift from the
database, because it is derived from the same schema your migrations
maintain — "maintaining entity contracts" reduces to the migration you were
already writing. `Model.pick("id", "name")` is Drizzle's
`columns: { id: true, name: true }` with an identity attached, and the
model's TypeScript value type is the exact `Pick` of the table's select
model, so handlers returning Drizzle rows just typecheck.

Column mapping is mechanical: `text` → `wire.string`, enum columns become
literal unions, `integer({ mode: "timestamp" })` → `wire.date`,
`{ mode: "boolean" }` → `wire.boolean`, JSON columns → the serializer
preflight codec, and nullable columns become `T | null` unions. A column
with no wire mapping throws at model definition with instructions to declare
that model by hand.

Two frictions are kept on purpose:

- **`columns` is a mandatory allowlist.** A wire contract that silently
  grows when a migration adds a column is a security bug, not a
  convenience — `passwordHash` never ships because nobody named it. When a
  migration adds a column you *want* on the wire, adding its name to the
  allowlist is the whole change.
- **Composite primary keys are named explicitly** (`key: ["id", "locale"]`).
  Single inline `.primaryKey()` columns are derived; table-level
  `primaryKey({ columns })` lives in an opaque config builder Drizzle does
  not expose, and guessing identity would be worse than asking.

## The Result-typed query door

Drizzle 1.0 ships an Effect bridge (per-driver `effect-*` entries with a
typed error channel). `tryDb` is the same idea for the Result-native stack:
run any Drizzle query (or a thunk, for drivers that throw at prepare time)
and get the database's failure vocabulary as a closed tagged union, parsed
from real driver codes — SQLite's `SQLITE_CONSTRAINT_*`, Postgres's
`23505`-family:

```ts
import { tryDb } from "result-rpc/drizzle"

const inserted = await tryDb(db.insert(reviews).values(row).returning())
if (!inserted.ok) {
  return matchError(inserted.error, {
    "db/unique-violation": () => err(errors.alreadyReviewed({ hotelId })),
    "db/foreign-key-violation": () => err(errors.hotelNotFound({ hotelId })),
    "db/not-null-violation": () => err(errors.invalid({})),
    "db/check-violation": () => err(errors.invalid({})),
    "db/query-failure": () => err(errors.unavailable({})),
  })
}
```

Attempting the insert IS the uniqueness check — correct under concurrency,
where the SELECT-first idiom races. The `db/*` tags are **server-side
composition currency, never wire errors**: all are `visibility: "private"`,
none belong in a procedure's `.errors()`. Handlers compose with them and
collapse to declared domain tags at the boundary — the same rule as
[Result composition](/concepts/results/)'s upstream services, specialized
for the database. One that slips through uncollapsed hits the
undeclared-tag safety net and sanitizes to `server/internal`.

## Bundle note

A models file that imports your Drizzle schema is shared with the client, so
the schema module's weight rides along. Drizzle table objects are inert
metadata and this is usually fine — but keep the schema module lean (tables
only, no driver imports at module top level), and `tryDb`/server code in
files the contract never imports.

`drizzle-orm` (>= 1.0) is an optional peer dependency — only this subpath
imports it, so apps without Drizzle pay nothing.

The worked proof is `examples/08-bookings`: real Drizzle 1.0 queries
(relations v2, column subsets, `groupBy` aggregates) feeding models derived
by this adapter, every freshness claim pinned by request counters — and its
`NOTES.md` carries the cost ledger comparing the model lines against the
equivalent tRPC + React Query invalidation code.

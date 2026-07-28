---
title: "Drizzle"
description: "Derive entity models from Drizzle tables, with an explicit client-bundle tradeoff."
---

A Drizzle table already declares columns, types, nullability, and its primary
key. `result-rpc/drizzle` can read those facts into a result-rpc entity model:

::::caution[Drizzle 1.x is required]
`result-rpc/drizzle` targets Drizzle ORM 1.x and declares
`drizzle-orm >= 1.0.0-rc` as its optional peer dependency. It is not
compatible with Drizzle 0.x.

Until Drizzle 1.0 is published to npm's `latest` tag, install matching 1.0
release candidates explicitly:

```sh
pnpm add drizzle-orm@rc
pnpm add -D drizzle-kit@rc
```

::::

```ts
import { modelFromDrizzle } from "result-rpc/drizzle";
import { hotels, tourContent, users } from "@app/db/schema";

export const Hotel = modelFromDrizzle("hotel", hotels, {
  columns: ["id", "name", "phone", "city"],
});
export const User = modelFromDrizzle("user", users, {
  columns: ["id", "name", "avatarUrl"],
});
export const TourContent = modelFromDrizzle("tour-content", tourContent, {
  columns: ["id", "locale", "title", "summary"],
  key: ["id", "locale"], // table-level composite PKs are named explicitly
});
```

::::caution[A wire allowlist is not bundle redaction]
An entity model is an executable codec on both sides of the wire. If a shared
contract imports the derived model above, its Drizzle table module and the
Drizzle metadata needed to construct it also enter the browser build.

The mandatory `columns` list prevents unlisted **values** from entering the
model or an RPC response. It does not erase unlisted table metadata from the
imported JavaScript module; private column names can still be visible in a
client bundle. Choose the shared-schema mode only when that metadata and
bundle cost are acceptable.
::::

This is Django's oldest, best move — `models.py` as the single source of
truth, with forms, serializers, and admin all _derived_ — reborn at the wire
boundary. The schema owns the facts; everything downstream is a projection
of it: table → model → `pick()` → output codec → client cache identity. One
`ALTER TABLE`-shaped change in one file, and the type checker walks it
through the contract, handlers, and components that render the field.

In this shared-schema mode, the wire model cannot drift from the database
because it is derived from the same schema your migrations maintain.
`Model.pick("id", "name")` is Drizzle's
`columns: { id: true, name: true }` with an identity attached, and the
model's TypeScript value type is the exact `Pick` of the table's select
model, so handlers returning Drizzle rows just typecheck.

## Strict client boundary

If database schema metadata has no business in the browser, keep the
contract's runtime model server-code-free and use `modelFromDrizzle` as a
server-only parity proof:

```ts
// contract.ts — safe to import in the browser
export const Note = defineModel("note", {
  key: "id",
  shape: {
    id: wire.string,
    title: wire.string,
    updatedAt: wire.date,
  },
});
```

```ts
// server/drizzle-model-proof.ts
import "server-only";
import type { ModelValue } from "result-rpc";
import { modelFromDrizzle } from "result-rpc/drizzle";
import { Note } from "../contract";
import { notes } from "./schema";

const DrizzleNote = modelFromDrizzle("note", notes, {
  columns: ["id", "title", "updatedAt"],
});

type Equal<A, B> = [A, B] extends [B, A] ? true : false;
const modelsAgree: Equal<ModelValue<typeof Note>, ModelValue<typeof DrizzleNote>> = true;
void modelsAgree;
```

This mode keeps Drizzle and every table identifier out of client chunks. It
also means the runtime codec is maintained explicitly; the type checker
catches field and TypeScript-type drift, but it cannot synthesize runtime
codecs from a type-only import. Build-time code generation would be required
to provide both automatic runtime derivation and a completely clean browser
boundary.

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
  migration adds a column you _want_ on the wire, adding its name to the
  allowlist is the whole change.
- **Composite primary keys are named explicitly** (`key: ["id", "locale"]`).
  Single inline `.primaryKey()` columns are derived; table-level
  `primaryKey({ columns })` lives in an opaque config builder Drizzle does
  not expose, and guessing identity would be worse than asking.

## The Result-typed query door

Drizzle 1.0's per-driver `effect-*` entries make query builders Effect values
and turn query failures into a tagged `EffectDrizzleQueryError`. That error
retains the query, parameters, and an Effect `Cause`; it does not classify
database constraints into separate error variants.

`tryDb` borrows the error-as-a-value boundary for the Result-native stack,
then adds the normalization an RPC handler needs. Run any standard Drizzle
query (or a thunk, for drivers that throw at prepare time) and get a closed
private union parsed from the underlying driver cause — SQLite constraint
codes and extended result codes, plus Postgres's `23505` family:

```ts
import { tryDb } from "result-rpc/drizzle";

const inserted = await tryDb(db.insert(reviews).values(row).returning());
if (!inserted.ok) {
  return matchError(inserted.error, {
    "db/unique-violation": () => err(errors.alreadyReviewed({ hotelId })),
    "db/foreign-key-violation": () => err(errors.hotelNotFound({ hotelId })),
    "db/not-null-violation": () => err(errors.invalid({})),
    "db/check-violation": () => err(errors.invalid({})),
    "db/query-failure": () => err(errors.unavailable({})),
  });
}
```

Each `db/*` value retains the original caught failure as its standard
non-enumerable `Error.cause`, including Drizzle's wrapper chain. The cause is
server-only diagnostic context: it is absent from `toJSON()`, encoded Result
data, and RPC responses. This preserves the information needed for local
logging without making SQL text, parameters, or driver internals part of a
wire contract.

Attempting the insert IS the uniqueness check — correct under concurrency,
where the SELECT-first idiom races. The `db/*` tags are **server-side
composition currency, never wire errors**: all are `visibility: "private"`,
none belong in a procedure's `.errors()`. Handlers compose with them and
collapse to declared domain tags at the boundary — the same rule as
[Result composition](/concepts/results/)'s upstream services, specialized
for the database. One that slips through uncollapsed hits the
undeclared-tag safety net and sanitizes to `server/internal`.

## Bundle note

In shared-schema mode, keep the imported schema module to table declarations
only: never put a driver, connection, environment read, migrations, or
`tryDb` code in the contract's import graph. In strict-boundary mode, protect
the entire schema and derived proof with the framework's server-only guard.

`drizzle-orm` (>= 1.0.0-rc) is an optional peer dependency — only this
subpath imports it, so apps without Drizzle pay nothing.

The worked proof is `examples/08-bookings`: real Drizzle 1.0 queries
(relations v2, column subsets, `groupBy` aggregates) feeding models derived
by this adapter, every freshness claim pinned by request counters — and its
`NOTES.md` carries the cost ledger comparing the model lines against the
equivalent tRPC + React Query invalidation code.

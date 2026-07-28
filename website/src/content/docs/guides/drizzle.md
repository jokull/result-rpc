---
title: "Drizzle"
description: "Keep an explicit client-safe model checked against a Drizzle row type."
---

A result-rpc model is a public wire contract, not a database schema mirror.
Declare the fields that may cross the wire, then use `$satisfies<Source>()`
to catch drift against Drizzle's inferred select type:

::::caution[These examples use Drizzle 1.x]
The Drizzle APIs in this guide and the worked examples target Drizzle ORM
1.x. While 1.0 is published under an npm prerelease tag, install matching
release candidates explicitly:

```sh
pnpm add drizzle-orm@rc
pnpm add -D drizzle-kit@rc
```

result-rpc itself does not depend on Drizzle.
::::

```ts
// contract/models.ts — safe to import in the browser
import { defineModel, wire } from "result-rpc";
import type { notes } from "../server/schema.js";

export const Note = defineModel("note", {
  key: "id",
  shape: {
    id: wire.string,
    title: wire.string,
    updatedAt: wire.date,
  },
}).$satisfies<typeof notes.$inferSelect>();
```

The import of `notes` is type-only and disappears from emitted JavaScript.
The client receives the explicit `defineModel` codec, not the Drizzle table,
its builders, or its private column names.

`$satisfies<Source>()` enforces one precise relationship:

- Every model field must exist in the source.
- Its TypeScript type and nullability must match exactly.
- The source may contain additional fields. They do not join the model.
- The assertion returns the same model and performs no runtime reflection.

If `notes.title` changes to `string | null`, the declaration above stops
type-checking until the public contract deliberately accepts or translates
that change. If the table gains `privateMemo`, nothing happens: it was never
named in the wire model.

The assertion is source-agnostic. It works with a query row, Prisma payload,
Kysely result, generated API type, or ordinary domain interface:

```ts
Note.$satisfies<NoteQueryRow>();
```

It does not infer codecs, identity, refinements, or database constraints.
Those are runtime contract decisions and remain visible in review. Full
runtime derivation would require executing the table module in the browser
or adding build-time code generation; result-rpc does neither.

## Composite keys and enums

Identity remains explicit. A locale-specific record is keyed by both fields,
and its wire enum is checked against Drizzle's inferred literal union:

```ts
import type { tourContent } from "../server/schema.js";

export const TourContent = defineModel("tour-content", {
  key: ["id", "locale"],
  shape: {
    id: wire.string,
    locale: wire.union([wire.literal("en"), wire.literal("ja")] as const),
    title: wire.string,
    summary: wire.string,
  },
}).$satisfies<typeof tourContent.$inferSelect>();
```

## Database failures as values

`result-rpc/db` is ORM-independent. `tryDb` accepts any thenable, follows
ordinary `Error.cause` and Effect Cause wrappers, and recognizes common
SQLite and PostgreSQL constraint failures:

```ts
import { tryDb } from "result-rpc/db";

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

Attempting the insert is the uniqueness check, including under concurrency.
Every `db/*` error is private server-side composition currency. Handlers
collapse it to a declared domain error; an uncollapsed database error is
sanitized to `server/internal` at the RPC boundary.

The original failure remains available locally as the tagged error's
non-enumerable `Error.cause`. SQL text, parameters, driver details, and the
cause are absent from JSON and RPC responses.

The worked proof is `examples/08-bookings`: real Drizzle 1.0 queries feed
explicit source-checked models, while `tryDb` turns database constraints into
domain outcomes. Request counters pin every cache-freshness claim.

---
title: "Database errors"
description: "Turn common database constraint failures into private tagged values."
---

`result-rpc/db` provides an ORM-independent Result boundary for database
operations. `tryDb` accepts any thenable—or a thunk for drivers that may throw
while preparing a query—and classifies common SQLite and PostgreSQL failures:

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

Attempting the insert is the uniqueness check. Unlike a SELECT-first check,
the constraint remains correct when two requests race.

## Private composition currency

Every `db/*` error is private. It belongs inside server implementation code,
not in a procedure's declared wire union:

| Tag                        | Meaning                                |
| -------------------------- | -------------------------------------- |
| `db/unique-violation`      | A unique or primary-key constraint hit |
| `db/foreign-key-violation` | A referenced row does not exist        |
| `db/not-null-violation`    | A required value was absent            |
| `db/check-violation`       | A database check rejected the value    |
| `db/query-failure`         | No more specific classification        |

Collapse that vocabulary into the procedure's domain errors at the handler
boundary. An uncollapsed database error is rejected by the contract and
sanitized to `server/internal` rather than leaking driver details.

## Cause retention

The tagged database error retains the original failure locally as its
standard, non-enumerable `Error.cause`. `tryDb` follows ordinary cause chains
and the common payload slots used by Effect Cause, allowing it to see through
ORM and driver wrappers.

The cause is diagnostic context only. SQL text, parameters, driver internals,
and the cause itself are absent from `toJSON()`, encoded Results, and RPC
responses.

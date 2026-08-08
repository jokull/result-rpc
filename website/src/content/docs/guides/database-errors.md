---
title: "Database errors"
description: "Fold database constraint failures into declared domain tags."
---

Database error handling is no longer part of result-rpc. It lives in
[`db-result`](https://github.com/jokull/db-result), a driver-agnostic Result
boundary built on better-result that classifies every driver failure into a
`db/*` tagged error (constraints, contention, connection, syntax — same
vocabulary across pg, SQLite, D1, mysql, mssql, Prisma, Kysely, and Drizzle)
and retries only what is provably safe.

```ts
import { matchErrorPartial } from "better-result";
import { tryDb } from "db-result/sqlite"; // or /pg /mysql2 /mssql /d1

const inserted = await tryDb(db.insert(reviews).values(row).returning());
if (inserted.status === "error") {
  return matchErrorPartial(
    inserted.error,
    {
      "db/unique-violation": () => err(errors.alreadyReviewed({ hotelId })),
    },
    (unhandled) => {
      throw unhandled;
    },
  );
}
```

Attempting the insert is the uniqueness check. Unlike a SELECT-first check,
the constraint remains correct when two requests race.

## The boundary folds the lane

The `db/*` tags are private composition currency, not wire errors: fold them
into your procedure's declared domain errors at the handler boundary.
result-rpc's contract rejects any undeclared error lane, so an uncollapsed
database error is sanitized to `server/internal` rather than leaking driver
details. The fold is mechanical — `matchErrorPartial` lists the tags you
handle, and its terminal arm is typed as the remainder the compiler lists for
you.

import { describe, expect, test } from "bun:test";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { dbErrors, tryDb } from "./db.js";

describe("tryDb", () => {
  const makeDb = async () => {
    const { Database } = await import("bun:sqlite");
    const { drizzle } = await import("drizzle-orm/bun-sqlite");
    const client = new Database(":memory:");
    client.run("PRAGMA foreign_keys = ON");
    client.run(
      "CREATE TABLE things (id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, parent TEXT REFERENCES things(id))",
    );
    return drizzle({ client });
  };
  const things = sqliteTable("things", {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    parent: text("parent"),
  });

  test("constraint outcomes become tagged values a handler can branch on", async () => {
    const db = await makeDb();
    const first = await tryDb(db.insert(things).values({ id: "a", label: "x" }));
    expect(first.ok).toBe(true);

    const dupe = await tryDb(db.insert(things).values({ id: "b", label: "x" }));
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) {
      expect(dupe.error._tag).toBe("db/unique-violation");
      expect(dupe.error.data).toEqual({ constraint: "things.label" });
    }

    const orphan = await tryDb(
      db.insert(things).values({ id: "c", label: "y", parent: "missing" }),
    );
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) expect(orphan.error._tag).toBe("db/foreign-key-violation");

    const broken = await tryDb(() => db.run("SELECT * FROM nonexistent"));
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error._tag).toBe("db/query-failure");
  });

  test("classifies a node:sqlite constraint through DrizzleQueryError.cause", async () => {
    const driverError = Object.assign(new Error("UNIQUE constraint failed: things.label"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 2067,
      errstr: "constraint failed",
    });
    const drizzleError = new Error(
      'Failed query: insert into "things" ("id", "label") values (?, ?)',
      { cause: driverError },
    );
    const duplicate = await tryDb(Promise.reject(drizzleError));

    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error._tag).toBe("db/unique-violation");
      expect(duplicate.error.data).toEqual({ constraint: "things.label" });
      expect(duplicate.error.cause).toBe(drizzleError);
      expect(JSON.stringify(duplicate.error)).not.toContain("Failed query");
    }
  });

  test("classifies a driver failure inside Drizzle's Effect Cause without exposing SQL", async () => {
    const driverError = Object.assign(new Error("UNIQUE constraint failed: things.label"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 2067,
    });
    const effectError = {
      _tag: "EffectDrizzleQueryError",
      query: 'insert into "things" ("id", "label") values (?, ?)',
      params: ["b", "TOP-SECRET-label"],
      cause: { _tag: "Fail", failure: driverError },
    };
    const duplicate = await tryDb(Promise.reject(effectError));

    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error._tag).toBe("db/unique-violation");
      expect(duplicate.error.data).toEqual({ constraint: "things.label" });
      expect(duplicate.error.cause).toBe(effectError);
      expect(JSON.stringify(duplicate.error)).not.toContain("TOP-SECRET-label");
    }
  });

  test("db errors are private composition currency, not wire errors", () => {
    expect(dbErrors.uniqueViolation({ constraint: "x" })._tag).toBe("db/unique-violation");
    // visibility private: an uncollapsed db error crossing the boundary
    // sanitizes to server/internal — pinned indirectly by the error policy.
  });
});

describe("constraint extraction", () => {
  // `data.constraint` is the wire payload of the tagged error. Anything the
  // driver or ORM appended after the column list — including query parameters —
  // must not be carried into it, and a handler matching on a constraint name
  // must get the name rather than the name plus prose.
  const extract = async (message: string) => {
    const outcome = await tryDb(
      Promise.reject(Object.assign(new Error(message), { code: "SQLITE_CONSTRAINT_UNIQUE" })),
    );
    if (outcome.ok) throw new Error("expected a database failure");
    return (outcome.error.data as { readonly constraint?: string }).constraint;
  };

  test("reads the column list and stops there", async () => {
    expect(await extract("UNIQUE constraint failed: things.label")).toBe("things.label");
    expect(await extract("UNIQUE constraint failed: things.label, things.tenant")).toBe(
      "things.label, things.tenant",
    );
  });

  test("does not absorb trailing driver prose", async () => {
    expect(await extract("UNIQUE constraint failed: things.label while inserting row 4")).toBe(
      "things.label",
    );
  });

  test("does not absorb query parameters that follow the message", async () => {
    const constraint = await extract(
      "UNIQUE constraint failed: things.label\nparams: hunter2, secret-token",
    );
    expect(constraint).toBe("things.label");
    expect(constraint).not.toContain("hunter2");
    expect(constraint).not.toContain("secret-token");
  });
});

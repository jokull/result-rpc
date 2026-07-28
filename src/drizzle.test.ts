import { describe, expect, test } from "bun:test";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { dbErrors, modelFromDrizzle, tryDb } from "./drizzle.js";
import { collectEntities } from "./model.js";

const hotels = sqliteTable("hotels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  rating: integer("rating"),
  secret: text("secret").notNull(),
});

const tourContent = sqliteTable(
  "tour_content",
  (_columns) => ({
    id: text("id").notNull(),
    locale: text("locale", { enum: ["en", "ja"] }).notNull(),
    title: text("title").notNull(),
  }),
  (t) => [primaryKey({ columns: [t.id, t.locale] })],
);

describe("modelFromDrizzle", () => {
  test("derives shape and single inline primary key; allowlist excludes the rest", () => {
    const Hotel = modelFromDrizzle("dz-hotel", hotels, {
      columns: ["id", "name", "phone"],
    });
    expect(Hotel.keyFields).toEqual(["id"]);
    const decoded = Hotel.all("test fixture").decode({ id: "h1", name: "Fuji Inn", phone: null });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("unreachable");
    // nullable column round-trips null; branded like any hand-written model
    expect(decoded.value.phone).toBeNull();
    expect(collectEntities([decoded.value]).map((entity) => entity.id)).toEqual(["h1"]);
    // the allowlist is the wire: a column not named does not decode
    expect(
      Hotel.all("test fixture").decode({ id: "h1", name: "x", phone: null, secret: "s" }).ok,
    ).toBe(false);
  });

  test("composite keys are explicit; enum columns become literal unions", () => {
    const TourContent = modelFromDrizzle("dz-tour", tourContent, {
      columns: ["id", "locale", "title"],
      key: ["id", "locale"],
    });
    expect(TourContent.keyFields).toEqual(["id", "locale"]);
    const decoded = TourContent.all("test fixture").decode({
      id: "t1",
      locale: "en",
      title: "Tokyo",
    });
    expect(decoded.ok).toBe(true);
    expect(TourContent.all("test fixture").decode({ id: "t1", locale: "fr", title: "x" }).ok).toBe(
      false,
    );
    expect(collectEntities([decoded.ok ? decoded.value : {}]).map((entity) => entity.id)).toEqual([
      "t1:en",
    ]);
  });

  test("errors are actionable: missing column, missing key", () => {
    expect(() => modelFromDrizzle("dz-bad", hotels, { columns: ["id", "nope" as never] })).toThrow(
      /no column "nope"/,
    );
    expect(() => modelFromDrizzle("dz-nokey", tourContent, { columns: ["id", "title"] })).toThrow(
      /pass `key` explicitly/,
    );
  });

  test("type-level: ModelValue matches the drizzle select subset", () => {
    const Hotel = modelFromDrizzle("dz-hotel-t", hotels, { columns: ["id", "name", "phone"] });
    const value: { id: string; name: string; phone: string | null } =
      null as never as import("./model.js").ModelValue<typeof Hotel>;
    void value;
  });
});

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

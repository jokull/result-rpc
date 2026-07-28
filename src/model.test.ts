import { describe, expect, test } from "bun:test";
import {
  collectEntities,
  defineModel,
  entityIdFor,
  entityBrandOf,
  mergeByExistingKeys,
  patchEntity,
} from "./model.js";
import { wire } from "./wire.js";

const User = defineModel("user", {
  key: "id",
  shape: {
    id: wire.string,
    name: wire.string,
    avatarUrl: wire.string,
  },
});

const Doc = defineModel("doc", {
  key: "id",
  shape: {
    id: wire.string,
    title: wire.string,
    author: User.all("test fixture"),
  },
});

describe("defineModel", () => {
  test("the canonical codec decodes and the kind carries the model name", () => {
    expect(Doc.all("test fixture").kind).toBe("model(doc):all");
    const decoded = Doc.all("test fixture").decode({
      id: "d1",
      title: "Roadmap",
      author: { id: "u1", name: "J", avatarUrl: "a.png" },
    });
    expect(decoded.ok).toBe(true);
  });

  test("pick projects a subset and demands the key", () => {
    const summary = Doc.pick("id", "title");
    expect(summary.kind).toBe("model(doc):id,title");
    expect(summary.decode({ id: "d1", title: "T" }).ok).toBe(true);
    expect(() => Doc.pick("title" as never)).toThrow("must include its key");
  });

  test("a missing key field in the shape is rejected at definition", () => {
    expect(() =>
      defineModel("broken", { key: "id" as never, shape: { name: wire.string } }),
    ).toThrow('key "id"');
  });
});

describe("collectEntities", () => {
  test("collects nested and array entities from decoded values, once per object", () => {
    const decoded = wire.array(Doc.all("test fixture")).decode([
      { id: "d1", title: "A", author: { id: "u1", name: "J", avatarUrl: "x" } },
      { id: "d2", title: "B", author: { id: "u1", name: "J", avatarUrl: "x" } },
    ]);
    if (!decoded.ok) throw new Error("decode failed");
    const entities = collectEntities(decoded.value);
    const keys = entities.map((entity) => `${entity.model.name}:${entity.id}`).sort();
    // two docs, two decoded author objects (distinct objects, same identity)
    expect(keys).toEqual(["doc:d1", "doc:d2", "user:u1", "user:u1"]);
  });

  test("undecoded plain objects collect nothing (the silent-miss contract)", () => {
    const raw = { id: "d1", title: "A" }; // never went through a model codec
    expect(collectEntities([raw])).toEqual([]);
  });

  test("entities inside Map and Set values are collected", () => {
    const decoded = Doc.all("test fixture").decode({
      id: "d1",
      title: "A",
      author: { id: "u1", name: "J", avatarUrl: "x" },
    });
    if (!decoded.ok) throw new Error("decode failed");
    const container = new Map([["docs", new Set([decoded.value])]]);
    const keys = collectEntities(container)
      .map((entity) => entity.model.name)
      .sort();
    expect(keys).toEqual(["doc", "user"]);
  });
});

describe("patchEntity", () => {
  const decode = () => {
    const decoded = wire.array(Doc.all("test fixture")).decode([
      { id: "d1", title: "A", author: { id: "u1", name: "J", avatarUrl: "old.png" } },
      { id: "d2", title: "B", author: { id: "u1", name: "J", avatarUrl: "old.png" } },
    ]);
    if (!decoded.ok) throw new Error("decode failed");
    return decoded.value as readonly Record<string, unknown>[];
  };

  test("replaces every occurrence by identity and leaves unrelated subtrees by reference", () => {
    const root = decode();
    const { value, changed } = patchEntity(root, User as never, "u1", (current) =>
      mergeByExistingKeys(current, { avatarUrl: "new.png" }),
    );
    expect(changed).toBe(true);
    const docs = value as readonly { title: string; author: { avatarUrl: string } }[];
    expect(docs[0]!.author.avatarUrl).toBe("new.png");
    expect(docs[1]!.author.avatarUrl).toBe("new.png");
    expect(docs[0]!.title).toBe("A");
    // the original is untouched
    expect((root[0]!.author as { avatarUrl: string }).avatarUrl).toBe("old.png");
  });

  test("patched entity objects stay branded, so a second patch still finds them", () => {
    const root = decode();
    const first = patchEntity(root, User as never, "u1", (current) =>
      mergeByExistingKeys(current, { avatarUrl: "v2.png" }),
    );
    const second = patchEntity(first.value, User as never, "u1", (current) =>
      mergeByExistingKeys(current, { avatarUrl: "v3.png" }),
    );
    expect(second.changed).toBe(true);
    const docs = second.value as readonly { author: { avatarUrl: string } }[];
    expect(docs[0]!.author.avatarUrl).toBe("v3.png");
  });

  test("no matching change returns the original root by reference", () => {
    const root = decode();
    const unchanged = patchEntity(root, User as never, "u1", (current) =>
      mergeByExistingKeys(current, { avatarUrl: "old.png" }),
    );
    expect(unchanged.changed).toBe(false);
    expect(unchanged.value).toBe(root);
    const missing = patchEntity(root, User as never, "nobody", (current) => current);
    expect(missing.changed).toBe(false);
    expect(missing.value).toBe(root);
  });

  test("the projection rule: merge touches only keys the cached object has", () => {
    const summaryCodec = Doc.pick("id", "title");
    const decoded = summaryCodec.decode({ id: "d1", title: "A" });
    if (!decoded.ok) throw new Error("decode failed");
    const root = [decoded.value];
    const { value } = patchEntity(root, Doc as never, "d1", (current) =>
      mergeByExistingKeys(current, {
        title: "renamed",
        author: { id: "u9" }, // not in the projection: must not appear
      }),
    );
    const summary = (value as Record<string, unknown>[])[0]!;
    expect(summary).toEqual({ id: "d1", title: "renamed" });
    expect("author" in summary).toBe(false);
  });

  test("cycles and shared references survive patching", () => {
    interface Node extends Record<string, unknown> {
      id: string;
      title: string;
      self?: Node;
    }
    const decoded = Doc.pick("id", "title").decode({ id: "d1", title: "A" });
    if (!decoded.ok) throw new Error("decode failed");
    const node = decoded.value as unknown as Node;
    node.self = node; // cycle through the entity itself
    const shared = { node };
    const root = { left: shared, right: shared };
    const { value, changed } = patchEntity(root, Doc as never, "d1", (current) =>
      mergeByExistingKeys(current, { title: "B" }),
    );
    expect(changed).toBe(true);
    const patched = value as { left: { node: Node }; right: { node: Node } };
    expect(patched.left.node.title).toBe("B");
    expect(patched.left.node).toBe(patched.right.node); // sharing preserved
  });
});

describe("composite keys", () => {
  const Content = defineModel("content", {
    key: ["id", "locale"],
    shape: { id: wire.string, locale: wire.string, title: wire.string },
  });

  test("each key combination is its own entity", () => {
    const en = Content.all("test fixture").decode({ id: "t1", locale: "en", title: "Tokyo" });
    const ja = Content.all("test fixture").decode({ id: "t1", locale: "ja", title: "東京" });
    if (!en.ok || !ja.ok) throw new Error("decode failed");
    const found = collectEntities([en.value, ja.value]);
    expect(found.map((entity) => entity.id).sort()).toEqual(["t1:en", "t1:ja"]);
  });

  test("patching one locale never touches the other", () => {
    const en = Content.all("test fixture").decode({ id: "t1", locale: "en", title: "Tokyo" });
    const ja = Content.all("test fixture").decode({ id: "t1", locale: "ja", title: "東京" });
    if (!en.ok || !ja.ok) throw new Error("decode failed");
    const root = { rows: [en.value, ja.value] };
    const { value, changed } = patchEntity(root, Content, "t1:en", (current) => ({
      ...current,
      title: "Tokyo!",
    }));
    expect(changed).toBe(true);
    const rows = (value as { rows: Array<{ title: string }> }).rows;
    expect(rows[0]!.title).toBe("Tokyo!");
    expect(rows[1]!.title).toBe("東京");
  });

  test("pick must include every key field", () => {
    expect(() => Content.pick("id", "title")).toThrow(/key "locale"/);
    expect(() => Content.pick("id", "locale", "title")).not.toThrow();
  });

  test("entityIdFor resolves records and pre-joined strings", () => {
    expect(entityIdFor(Content, { id: "t1", locale: "en" })).toBe("t1:en");
    expect(entityIdFor(Content, "t1:en")).toBe("t1:en");
    expect(entityIdFor(Content, { id: "t1" } as never)).toBeUndefined();
  });
});

describe("scoped outputs", () => {
  const Person = defineModel("person", {
    key: "id",
    shape: { id: wire.string, name: wire.string, lat: wire.number },
  });

  test("all() demands a reason — a wide output states why in review", () => {
    expect(() => (Person.all as (reason?: string) => unknown)()).toThrow(/takes a reason/);
    expect(() => Person.all("   ")).toThrow(/takes a reason/);
    expect(Person.all("the viewer is the subject").kind).toBe("model(person):all");
  });

  test("select mixes own fields, nested codecs, and computed values", () => {
    const Card = Person.pick("id", "name");
    const Row = Person.select({
      id: true,
      name: true,
      friend: Card,
      mutualCount: wire.number,
    });
    const decoded = Row.decode({
      id: "p1",
      name: "Ada",
      friend: { id: "p2", name: "Grace" },
      mutualCount: 3,
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("unreachable");
    // The narrow view cannot carry what it does not name.
    expect("lat" in (decoded.value as object)).toBe(false);
    // Identity survives at every level: root and nested are both branded.
    expect(entityBrandOf(decoded.value as object)).toBe(Person as never);
    expect(entityBrandOf((decoded.value as { friend: object }).friend)).toBe(Person as never);
  });

  test("a selection still demands the key — identity is not optional", () => {
    expect(() => Person.select({ name: true })).toThrow(/must include its key/);
  });

  test("select rejects a true for a field the model does not have", () => {
    expect(() => Person.select({ id: true, nope: true } as never)).toThrow(/has no field "nope"/);
  });

  test("a wide payload cannot widen a narrow cached row", () => {
    // The merge rule is the cache-layer half of the same guarantee: a
    // mutation returning every field patches only the keys a narrow row
    // already holds, so a friend-list row never gains coordinates.
    const narrow = { id: "p1", name: "Ada" };
    const wide = { id: "p1", name: "Ada Lovelace", lat: 51.5 };
    const merged = mergeByExistingKeys(narrow, wide);
    expect(merged).toEqual({ id: "p1", name: "Ada Lovelace" });
    expect("lat" in merged).toBe(false);
  });
});

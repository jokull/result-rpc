import { describe, expect, test } from "bun:test";
import {
  collectEntities,
  defineModel,
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
    author: User.codec,
  },
});

describe("defineModel", () => {
  test("the canonical codec decodes and the kind carries the model name", () => {
    expect(Doc.codec.kind).toBe("model(doc)");
    const decoded = Doc.codec.decode({
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
    expect(() => defineModel("broken", { key: "id" as never, shape: { name: wire.string } }))
      .toThrow('key "id"');
  });
});

describe("collectEntities", () => {
  test("collects nested and array entities from decoded values, once per object", () => {
    const decoded = wire.array(Doc.codec).decode([
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
    const decoded = Doc.codec.decode({
      id: "d1", title: "A", author: { id: "u1", name: "J", avatarUrl: "x" },
    });
    if (!decoded.ok) throw new Error("decode failed");
    const container = new Map([["docs", new Set([decoded.value])]]);
    const keys = collectEntities(container).map((entity) => entity.model.name).sort();
    expect(keys).toEqual(["doc", "user"]);
  });
});

describe("patchEntity", () => {
  const decode = () => {
    const decoded = wire.array(Doc.codec).decode([
      { id: "d1", title: "A", author: { id: "u1", name: "J", avatarUrl: "old.png" } },
      { id: "d2", title: "B", author: { id: "u1", name: "J", avatarUrl: "old.png" } },
    ]);
    if (!decoded.ok) throw new Error("decode failed");
    return decoded.value as readonly Record<string, unknown>[];
  };

  test("replaces every occurrence by identity and leaves unrelated subtrees by reference", () => {
    const root = decode();
    const { value, changed } = patchEntity(root, User as never, "u1", (current) =>
      mergeByExistingKeys(current, { avatarUrl: "new.png" }));
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
      mergeByExistingKeys(current, { avatarUrl: "v2.png" }));
    const second = patchEntity(first.value, User as never, "u1", (current) =>
      mergeByExistingKeys(current, { avatarUrl: "v3.png" }));
    expect(second.changed).toBe(true);
    const docs = second.value as readonly { author: { avatarUrl: string } }[];
    expect(docs[0]!.author.avatarUrl).toBe("v3.png");
  });

  test("no matching change returns the original root by reference", () => {
    const root = decode();
    const unchanged = patchEntity(root, User as never, "u1", (current) =>
      mergeByExistingKeys(current, { avatarUrl: "old.png" }));
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
        author: { id: "u9" },      // not in the projection: must not appear
      }));
    const summary = (value as Record<string, unknown>[])[0]!;
    expect(summary).toEqual({ id: "d1", title: "renamed" });
    expect("author" in summary).toBe(false);
  });

  test("cycles and shared references survive patching", () => {
    interface Node extends Record<string, unknown> { id: string; title: string; self?: Node }
    const decoded = Doc.pick("id", "title").decode({ id: "d1", title: "A" });
    if (!decoded.ok) throw new Error("decode failed");
    const node = decoded.value as unknown as Node;
    node.self = node; // cycle through the entity itself
    const shared = { node };
    const root = { left: shared, right: shared };
    const { value, changed } = patchEntity(root, Doc as never, "d1", (current) =>
      mergeByExistingKeys(current, { title: "B" }));
    expect(changed).toBe(true);
    const patched = value as { left: { node: Node }; right: { node: Node } };
    expect(patched.left.node.title).toBe("B");
    expect(patched.left.node).toBe(patched.right.node); // sharing preserved
  });
});

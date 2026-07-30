import { describe, expect, test } from "bun:test";
import {
  collectEntities,
  defineModel,
  entityIdFor,
  entityBrandOf,
  entityKey,
  mergeByExistingKeys,
  patchEntity,
} from "./model.js";
import { deserialize, serialize } from "./serializer.js";
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

const requireEntityId = <TModel extends Parameters<typeof entityIdFor>[0]>(
  model: TModel,
  id: Parameters<typeof entityIdFor<TModel>>[1],
) => {
  const resolved = entityIdFor(model, id);
  if (resolved === undefined) throw new Error(`invalid test identity for ${model.name}`);
  return resolved;
};

describe("defineModel", () => {
  test("$satisfies is a type-only assertion that preserves model identity", () => {
    interface SourceUser {
      readonly id: string;
      readonly name: string;
      readonly avatarUrl: string;
      readonly privateMemo: string;
    }

    expect(User.$satisfies<SourceUser>()).toBe(User);
  });

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
    const unsafePick = Doc.pick as (...keys: string[]) => unknown;
    expect(() => unsafePick("title")).toThrow("must include its key");
  });

  test("a missing key field in the shape is rejected at definition", () => {
    const unsafeDefineModel = defineModel as (
      name: string,
      options: { readonly key: string; readonly shape: Readonly<Record<string, unknown>> },
    ) => unknown;
    expect(() => unsafeDefineModel("broken", { key: "id", shape: { name: wire.string } })).toThrow(
      'key "id"',
    );
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
    const keys = entities.map((entity) => entity.id).sort();
    // two docs, two decoded author objects (distinct objects, same identity)
    expect(keys).toEqual(
      [
        requireEntityId(Doc, "d1"),
        requireEntityId(Doc, "d2"),
        requireEntityId(User, "u1"),
        requireEntityId(User, "u1"),
      ].sort(),
    );
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
    const { value, changed } = patchEntity(root, User, requireEntityId(User, "u1"), (current) =>
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
    const first = patchEntity(root, User, requireEntityId(User, "u1"), (current) =>
      mergeByExistingKeys(current, { avatarUrl: "v2.png" }),
    );
    const second = patchEntity(first.value, User, requireEntityId(User, "u1"), (current) =>
      mergeByExistingKeys(current, { avatarUrl: "v3.png" }),
    );
    expect(second.changed).toBe(true);
    const docs = second.value as readonly { author: { avatarUrl: string } }[];
    expect(docs[0]!.author.avatarUrl).toBe("v3.png");
  });

  test("no matching change returns the original root by reference", () => {
    const root = decode();
    const unchanged = patchEntity(root, User, requireEntityId(User, "u1"), (current) =>
      mergeByExistingKeys(current, { avatarUrl: "old.png" }),
    );
    expect(unchanged.changed).toBe(false);
    expect(unchanged.value).toBe(root);
    const missing = patchEntity(root, User, requireEntityId(User, "nobody"), (current) => current);
    expect(missing.changed).toBe(false);
    expect(missing.value).toBe(root);
  });

  test("the projection rule: merge touches only keys the cached object has", () => {
    const summaryCodec = Doc.pick("id", "title");
    const decoded = summaryCodec.decode({ id: "d1", title: "A" });
    if (!decoded.ok) throw new Error("decode failed");
    const root = [decoded.value];
    const { value } = patchEntity(root, Doc, requireEntityId(Doc, "d1"), (current) =>
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
    const { value, changed } = patchEntity(root, Doc, requireEntityId(Doc, "d1"), (current) =>
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
    expect(found.map((entity) => entity.id).sort()).toEqual(
      [
        requireEntityId(Content, { id: "t1", locale: "en" }),
        requireEntityId(Content, { id: "t1", locale: "ja" }),
      ].sort(),
    );
  });

  test("patching one locale never touches the other", () => {
    const en = Content.all("test fixture").decode({ id: "t1", locale: "en", title: "Tokyo" });
    const ja = Content.all("test fixture").decode({ id: "t1", locale: "ja", title: "東京" });
    if (!en.ok || !ja.ok) throw new Error("decode failed");
    const root = { rows: [en.value, ja.value] };
    const { value, changed } = patchEntity(
      root,
      Content,
      requireEntityId(Content, { id: "t1", locale: "en" }),
      (current) => ({
        ...current,
        title: "Tokyo!",
      }),
    );
    expect(changed).toBe(true);
    const rows = (value as { rows: Array<{ title: string }> }).rows;
    expect(rows[0]!.title).toBe("Tokyo!");
    expect(rows[1]!.title).toBe("東京");
  });

  test("pick must include every key field", () => {
    const unsafePick = Content.pick as (...keys: string[]) => unknown;
    expect(() => unsafePick("id", "title")).toThrow(/key "locale"/);
    expect(() => Content.pick("id", "locale", "title")).not.toThrow();
  });

  test("entityIdFor requires structured composite keys", () => {
    expect(entityIdFor(Content, { id: "t1", locale: "en" })).toBeDefined();
    const unsafeEntityIdFor = entityIdFor as (
      model: typeof Content,
      id: unknown,
    ) => string | undefined;
    expect(unsafeEntityIdFor(Content, "t1:en")).toBeUndefined();
    expect(entityIdFor(Content, { id: "t1" } as never)).toBeUndefined();
  });
});

describe("canonical entity identity", () => {
  test("delimiter placement and composite arity cannot collide or cross-patch", () => {
    const Localized = defineModel("identity-delimiters", {
      key: ["id", "locale"],
      shape: { id: wire.string, locale: wire.string, title: wire.string },
    });
    const left = Localized.all("test fixture").decode({
      id: "a:b",
      locale: "c",
      title: "left",
    });
    const right = Localized.all("test fixture").decode({
      id: "a",
      locale: "b:c",
      title: "right",
    });
    if (!left.ok || !right.ok) throw new Error("decode failed");

    const leftId = requireEntityId(Localized, { id: "a:b", locale: "c" });
    const rightId = requireEntityId(Localized, { id: "a", locale: "b:c" });
    expect(leftId).not.toBe(rightId);

    const patched = patchEntity([left.value, right.value], Localized, leftId, (current) => ({
      ...current,
      title: "patched",
    }));
    expect(patched.changed).toBe(true);
    expect(patched.value).toEqual([
      { id: "a:b", locale: "c", title: "patched" },
      { id: "a", locale: "b:c", title: "right" },
    ]);

    const Single = defineModel("identity-arity", {
      key: "id",
      shape: { id: wire.string },
    });
    const Composite = defineModel("identity-arity", {
      key: ["id", "locale"],
      shape: { id: wire.string, locale: wire.string },
    });
    expect(requireEntityId(Single, "a:b")).not.toBe(
      requireEntityId(Composite, { id: "a", locale: "b" }),
    );
  });

  test("numeric and string values remain different identities", () => {
    const Mixed = defineModel("identity-scalar-types", {
      key: "id",
      shape: { id: wire.union([wire.string, wire.number]), label: wire.string },
    });
    const numeric = Mixed.all("test fixture").decode({ id: 1, label: "numeric" });
    const textual = Mixed.all("test fixture").decode({ id: "1", label: "textual" });
    if (!numeric.ok || !textual.ok) throw new Error("decode failed");

    const numericId = requireEntityId(Mixed, 1);
    const textualId = requireEntityId(Mixed, "1");
    expect(numericId).not.toBe(textualId);

    const patched = patchEntity([numeric.value, textual.value], Mixed, numericId, (current) => ({
      ...current,
      label: "patched",
    }));
    expect(patched.value).toEqual([
      { id: 1, label: "patched" },
      { id: "1", label: "textual" },
    ]);
  });

  test("model-name boundaries, Unicode, empty strings, and numeric edges are injective", () => {
    const strings = ["", ":", "a:b", "東京", "💎", "\0", '"],["n","1"]'] as const;
    const numbers = [
      0,
      -0,
      1,
      -1,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ] as const;
    const modelNames = ["", ":", "model:part", "モデル", '"],["s","x"]'] as const;
    const identities = new Map<string, string>();
    const record = (id: string, logical: string) => {
      const previous = identities.get(id);
      expect(previous === undefined || previous === logical).toBe(true);
      identities.set(id, logical);
    };

    for (const modelName of modelNames) {
      const StringKey = defineModel(modelName, {
        key: "id",
        shape: { id: wire.string },
      });
      const NumberKey = defineModel(modelName, {
        key: "id",
        shape: { id: wire.number },
      });
      const CompositeKey = defineModel(modelName, {
        key: ["left", "right"],
        shape: { left: wire.string, right: wire.union([wire.string, wire.number]) },
      });

      for (const value of strings) {
        record(requireEntityId(StringKey, value), JSON.stringify([modelName, ["s", value]]));
        for (const right of [...strings, ...numbers]) {
          const rightLogical =
            typeof right === "string"
              ? ["s", right]
              : ["n", Number.isNaN(right) ? "NaN" : Object.is(right, -0) ? "-0" : String(right)];
          record(
            requireEntityId(CompositeKey, { left: value, right }),
            JSON.stringify([modelName, ["s", value], rightLogical]),
          );
        }
      }
      for (const value of numbers) {
        const logical = Number.isNaN(value) ? "NaN" : Object.is(value, -0) ? "-0" : String(value);
        record(requireEntityId(NumberKey, value), JSON.stringify([modelName, ["n", logical]]));
      }
    }

    // Every generated logical identity got its own canonical string.
    expect(identities.size).toBe(
      modelNames.length *
        (strings.length + numbers.length + strings.length * (strings.length + numbers.length)),
    );

    const ModelBoundaryA = defineModel("a:b", {
      key: "id",
      shape: { id: wire.string },
    });
    const ModelBoundaryB = defineModel("a", {
      key: "id",
      shape: { id: wire.string },
    });
    expect(requireEntityId(ModelBoundaryA, "c")).not.toBe(requireEntityId(ModelBoundaryB, "b:c"));
  });

  test("numeric identity semantics survive the configured serializer", () => {
    const Numeric = defineModel("identity-wire-number", {
      key: "id",
      shape: { id: wire.number },
    });
    for (const id of [
      0,
      -0,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      const serialized = serialize({ id });
      if (!serialized.ok) throw new Error(serialized.message);
      const deserialized = deserialize(serialized.value);
      if (!deserialized.ok) throw new Error(deserialized.message);
      const decoded = Numeric.all("test fixture").decode(deserialized.value);
      if (!decoded.ok) throw new Error("decode failed");
      expect(collectEntities(decoded.value)[0]?.id).toBe(requireEntityId(Numeric, id));
    }
  });

  test("the cache-key boundary rejects unqualified and non-canonical strings", () => {
    const Boundary = defineModel("identity-cache-boundary", {
      key: "id",
      shape: { id: wire.string },
    });
    const id = requireEntityId(Boundary, "x");
    expect(String(entityKey(Boundary.name, id))).toBe(String(id));

    const unsafeEntityKey = entityKey as unknown as (model: string, id: string) => string;
    expect(() => unsafeEntityKey("other-model", id)).toThrow(/canonical identity/);
    expect(() => unsafeEntityKey(Boundary.name, "x")).toThrow(/canonical identity/);
    expect(() =>
      unsafeEntityKey(
        Boundary.name,
        'result-rpc:entity:1:[["s","identity-cache-boundary"],["n","01"]]',
      ),
    ).toThrow(/canonical identity/);
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
    expect(entityBrandOf(decoded.value as object)).toBe(Person);
    expect(entityBrandOf((decoded.value as { friend: object }).friend)).toBe(Person);
  });

  test("a selection still demands the key — identity is not optional", () => {
    const unsafeSelect = Person.select as (selection: Readonly<Record<string, unknown>>) => unknown;
    expect(() => unsafeSelect({ name: true })).toThrow(/must include its key/);
  });

  test("select rejects a true for a field the model does not have", () => {
    const unsafeSelect = Person.select as (selection: Readonly<Record<string, unknown>>) => unknown;
    expect(() => unsafeSelect({ id: true, nope: true })).toThrow(/has no field "nope"/);
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

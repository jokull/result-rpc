/**
 * Attack 2: an occurrence of the target entity nested INSIDE the target
 * entity itself is never patched.
 *
 * patchEntity's walk stops at a matched entity: it calls produce() and
 * returns, never walking the produced object's children. mergeByExistingKeys
 * copies the OLD child references over. So for a self-cycle (node.self =
 * node) — the exact structure src/model.test.ts "cycles and shared
 * references survive patching" celebrates — the patched clone's `self` still
 * points at the OLD object with the OLD field values, and the cycle is
 * broken (self !== node').
 */
import { describe, expect, test } from "bun:test";
import { wire } from "../../src/index.js";
import { defineModel, mergeByExistingKeys, patchEntity } from "../../src/model.js";

const Node = defineModel("a02-node", {
  key: "id",
  shape: { id: wire.string, title: wire.string },
});

describe("attack-02 nested self occurrence", () => {
  test("self-cycle: the inner occurrence keeps the stale title and the cycle breaks", () => {
    interface N extends Record<string, unknown> { id: string; title: string; self?: N }
    const decoded = Node.all("test fixture").decode({ id: "n1", title: "old" });
    if (!decoded.ok) throw new Error("decode failed");
    const node = decoded.value as unknown as N;
    node.self = node;

    const { value, changed } = patchEntity([node], Node as never, "n1", (current) =>
      mergeByExistingKeys(current, { title: "new" }));
    expect(changed).toBe(true);
    const patched = (value as N[])[0]!;
    expect(patched.title).toBe("new");
    // ATTACK ASSERTIONS: the nested occurrence must be the same fresh object.
    expect(patched.self!.title).toBe("new");   // stale "old" if broken
    expect(patched.self).toBe(patched);        // cycle must survive re-entrantly
  });

  test("target nested under a DIFFERENT parent entity IS patched (control)", () => {
    const Parent = defineModel("a02-parent", {
      key: "id",
      shape: { id: wire.string, child: Node.all("test fixture") },
    });
    const decoded = Parent.all("test fixture").decode({ id: "p1", child: { id: "n1", title: "old" } });
    if (!decoded.ok) throw new Error("decode failed");
    const { value } = patchEntity(decoded.value, Node as never, "n1", (current) =>
      mergeByExistingKeys(current, { title: "new" }));
    expect((value as { child: { title: string } }).child.title).toBe("new");
  });
});

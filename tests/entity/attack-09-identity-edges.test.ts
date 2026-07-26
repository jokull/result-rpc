/**
 * Attack 9: identity/branding edge cases at the model layer.
 *
 * 9a: entity used as a Map KEY — collectEntities and patchEntity walk only
 *     map.values(), so key-position entities are neither indexed nor patched.
 * 9b: entity as Set member — walked; patch should rebuild the Set.
 * 9c: same id under two different models must not cross-patch.
 * 9d: canonical AND pick() projection of the same entity in ONE result —
 *     both occurrences patched, projection stays narrow.
 * 9e: double-branding — an object decoded by model A's codec then re-decoded
 *     by model B's codec: last brand wins silently (wire.object may return
 *     the same object). Pin what happens.
 */
import { describe, expect, test } from "bun:test";
import { wire } from "../../src/index.js";
import { collectEntities, defineModel, mergeByExistingKeys, patchEntity } from "../../src/model.js";

const User = defineModel("a09-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});
const Team = defineModel("a09-team", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});

const decodeUser = (id: string, name: string) => {
  const decoded = User.all("test fixture").decode({ id, name });
  if (!decoded.ok) throw new Error("decode failed");
  return decoded.value as { id: string; name: string };
};

describe("attack-09 identity edges", () => {
  test("9a: an entity used as a Map key is collected and patched", () => {
    const user = decodeUser("u1", "old");
    const container = new Map([[user, "score:10"]]);
    // ATTACK ASSERTION: key-position entities should be seen.
    expect(collectEntities(container).length).toBe(1);
    const { changed } = patchEntity(container, User as never, "u1", (c) =>
      mergeByExistingKeys(c, { name: "new" }));
    expect(changed).toBe(true);
  });

  test("9b: an entity as Set member is patched", () => {
    const user = decodeUser("u1", "old");
    const container = new Set([user]);
    expect(collectEntities(container).length).toBe(1);
    const { value, changed } = patchEntity(container, User as never, "u1", (c) =>
      mergeByExistingKeys(c, { name: "new" }));
    expect(changed).toBe(true);
    expect([...(value as Set<{ name: string }>)][0]!.name).toBe("new");
  });

  test("9c: same id under two models never cross-patches", () => {
    const user = decodeUser("x1", "user-name");
    const teamDecoded = Team.all("test fixture").decode({ id: "x1", name: "team-name" });
    if (!teamDecoded.ok) throw new Error("decode failed");
    const root = [user, teamDecoded.value];
    const { value } = patchEntity(root, User as never, "x1", (c) =>
      mergeByExistingKeys(c, { name: "patched" }));
    const [u, t] = value as [{ name: string }, { name: string }];
    expect(u.name).toBe("patched");
    expect(t.name).toBe("team-name"); // untouched
    // and the index keys differ
    const keys = collectEntities(root).map((e) => `${e.model.name}:${e.id}`).sort();
    expect(keys).toEqual(["a09-team:x1", "a09-user:x1"]);
  });

  test("9d: canonical and pick() of the same entity in one result both patch, projection stays narrow", () => {
    const Brief = User.pick("id", "name");
    const Full = defineModel("a09-full-user", {
      key: "id",
      shape: { id: wire.string, name: wire.string, email: wire.string },
    });
    const BriefFull = Full.pick("id", "name");
    const full = Full.all("test fixture").decode({ id: "u1", name: "old", email: "a@b.c" });
    const brief = BriefFull.decode({ id: "u1", name: "old" });
    if (!full.ok || !brief.ok) throw new Error("decode failed");
    const root = { detail: full.value, row: brief.value };
    const { value } = patchEntity(root, Full as never, "u1", (c) =>
      mergeByExistingKeys(c, { name: "new", email: "n@b.c" }));
    const patched = value as { detail: Record<string, unknown>; row: Record<string, unknown> };
    expect(patched.detail).toEqual({ id: "u1", name: "new", email: "n@b.c" });
    expect(patched.row).toEqual({ id: "u1", name: "new" }); // narrow, no email leak
    void Brief;
  });

  test("9e: re-decoding the same object through another model's codec — pin the branding outcome", () => {
    const user = decodeUser("u1", "n");
    // A hostile/buggy composition: the ALREADY-DECODED object goes through
    // Team's codec (e.g. wire.serializable boundaries, or manual re-decode).
    const redecoded = Team.all("test fixture").decode(user);
    if (!redecoded.ok) throw new Error("decode failed");
    const entities = collectEntities([user]);
    // ATTACK ASSERTION: the original object should still be a User entity.
    expect(entities.map((e) => e.model.name)).toEqual(["a09-user"]);
  });
});

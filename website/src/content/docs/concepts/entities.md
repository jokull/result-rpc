---
title: "Entities"
description: "Automatic invalidation and in-place updates by model + id \u2014 the identity graph over the denormalized cache."
---

Update your profile picture. The avatar in the header, the byline on every
cached doc, and the member row in settings all show the new picture
**immediately** — no query invalidated, no refetch issued, nothing written at
any call site:

```ts
export const User = defineModel("user", {
  key: "id",
  shape: { id: wire.string, name: wire.string, avatarUrl: wire.url },
})

const setAvatar = app.procedure()
  .input(wire.object({ image: wire.file({ accept: ["image/*"] }) }))
  .output(User.codec)                     // ← returns WHO changed
  .mutation(...)
```

The mutation returned a `user` entity; the cache knows every query whose
result contains `user:u_1`; each one is patched in place. That is the whole
feature: **automatic invalidation and automatic updates by model + id**.

A model is to values what an error definition is to failures — a named,
shared declaration. `Doc.codec` is the canonical shape; `Doc.pick("id",
"title")` declares a projection (the key field is mandatory — an entity
without its identity is just data). Use them anywhere in outputs, at any
depth, including inside each other. The mechanics are the decode pass you
already pay for: decoding brands entity objects, the runtime indexes every
cached result by the entities it contains, and mutations that return
entities patch by identity. There are no heuristics and no schema walking —
**an inline `wire.object` collects nothing, silently**; composing outputs
from model codecs is the one discipline this asks of query writers.

Patches follow the **projection rule**: merge only the fields the cached
object already has (one model, one field vocabulary; projections are
subsets). Fields the mutation didn't return stay stale-until-refetch —
correct and honest.

## The division of labor

> **Identities handle field freshness. `.affects()` handles membership.**

A rename updates every cached row by identity. Only "which cached lists
should now contain this new doc" needs a declaration — the same boundary
Graphcache draws with manual updaters, except ours is typed and lives in
the contract. The mutation writer's decision table:

| The write changes… | Use |
| --- | --- |
| Fields of an entity | return the entity — auto-patch everywhere |
| Fields, but the output must stay scalar | `.writes(Doc, (input) => input.id)` — invalidation by identity |
| List membership | `.affects(listQuery)` |
| Entities the output can't mention (cascades, **deletes**) | `touch(Model, id)` in the handler |

`touch` rides the response envelope as `model:id` keys — identities only,
never values — and invalidates by identity client-side:

```ts
.mutation(({ input, context, touch }) => {
  await context.db.docs.delete(input.id)
  touch(Doc, input.id)                    // a deleted entity can't be returned
  return ok(true)
})
```

## Optimistic by identity, trivial with client-minted ids

`cache.updateEntity` addresses the cache the way you think about it:

```ts
const rename = useResultMutation(client.doc.rename, {
  optimistic: (input, cache) => ({
    rollback: cache.updateEntity(Doc, input.id, (doc) => ({ ...doc, title: input.title })),
  }),
  onFailure: (_e, _i, ctx) => ctx?.rollback(),
})
```

One line patches the detail view, every list row, every breadcrumb. And if
the client mints ids (cuid2, nanoid, uuidv7), optimistic **creates** stop
being a reconciliation problem: the optimistic entity is born under its
*final* identity, so the server's response is a no-op patch or a field
correction — nothing re-keys, nothing flickers, and the id doubles as a
natural idempotency key. Add
[fractional indexing](https://github.com/rocicorp/fractional-indexing) and
order becomes a field too: a drag-reorder is one `sortKey` patch and every
cached list re-sorts locally — no list invalidation for reorders, ever.

## What this deliberately is not

There is no normalized store. Per-query results stay the source of truth —
denormalized, exactly typed — with an identity index over them. The
store-as-source-of-truth design (Graphcache, Apollo) exists to serve
flexible queries and would trade away exact per-procedure output types,
which everything else here is built on. Permanent non-goal.

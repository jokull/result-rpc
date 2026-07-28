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
  .input(wire.object({ key: wire.string }))   // a bucket reference; bytes are out of band
  .output(UserCard)                            // ← returns WHO changed
  .mutation(...)
```

The mutation returned a `user` entity; the cache knows every query whose
result contains `user:u_1`; each one is patched in place — automatic
invalidation and automatic updates by model + id.

On the client, the full extent of the wiring is the mutation call itself:

```tsx
<select onChange={(e) => void assign.mutate({ issueId, assigneeId: e.target.value })}>
```

The list row, the detail header, and this very select all update in place.
A test in `examples/07-tracker` asserts it with per-procedure
request counters, not screenshots: after the mutation settles, the counts
equal `{ ...baseline, "issues.assign": 1 }` — one request in the whole
world, zero refetches anywhere.

A model is to values what an error definition is to failures — a named,
shared declaration. `Doc.all("why")` is every field; `Doc.pick("id",
"title")` declares a projection (the key field is mandatory — an entity
without its identity is just data). Use them anywhere in outputs, at any
depth, including inside each other. The mechanics are the decode pass you
already pay for: decoding brands entity objects, the runtime indexes every
cached result by the entities it contains, and mutations that return
entities patch by identity. There are no heuristics and no schema walking —
**an inline `wire.object` collects nothing, silently**; composing outputs
from model views is the one discipline this asks of query writers.

Here, **projection describes the declared wire shape, not a mapping
operation**. Model views are strict codecs: `Doc.pick("id", "title")` accepts
exactly those fields and rejects `{ id, title, privateNotes }`; it does not
silently strip `privateNotes`. Select those columns in the database query or
map the row to the exact output shape. TypeScript may accept a wider variable
because structural assignability permits extra properties, but the runtime
codec deliberately does not — otherwise accidental fields could cross the
wire unnoticed.

## Source compatibility

When a model mirrors part of an upstream row or domain type, attach a
compile-time drift proof without importing that source at runtime:

```ts
import type { docs } from "../server/schema.js";

export const Doc = defineModel("doc", {
  key: "id",
  shape: { id: wire.string, title: wire.string },
}).$satisfies<typeof docs.$inferSelect>();
```

Every model field must exist in the source with the same type and
nullability; extra source fields are allowed and remain outside the wire
contract. `$satisfies<Source>()` works with any source type and returns the
same model. The type-only import is erased, so the source module does not
enter the client graph. See [Model source compatibility](/concepts/model-sources/)
for exact matching rules, limitations, and non-database examples.

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

| The write changes…                                        | Use                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| Fields of an entity                                       | return the entity — auto-patch everywhere                      |
| Fields, but the output must stay scalar                   | `.writes(Doc, (input) => input.id)` — invalidation by identity |
| List membership                                           | `.affects(listQuery)`                                          |
| Entities the output can't mention (cascades, **deletes**) | `touch(Model, id)` in the handler                              |

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
});
```

One line patches the detail view, every list row, every breadcrumb. And if
the client mints ids (cuid2, nanoid, uuidv7), optimistic **creates** stop
being a reconciliation problem: the optimistic entity is born under its
_final_ identity, so the server's response is a no-op patch or a field
correction — nothing re-keys, nothing flickers, and the id doubles as a
natural idempotency key. Add
[fractional indexing](https://github.com/rocicorp/fractional-indexing) and
order becomes a field too: a drag-reorder is one `sortKey` patch and every
cached list re-sorts locally — no list invalidation for reorders, ever.

## What the coherence oracle pins

The entity system is tested by an adversarial suite (26 attack probes,
`tests/entity/`) and a **coherence oracle**: seeded-random interleavings of
mounts, unmounts, mutations, and invalidations against a reference database,
asserting after every settle that active observers match the oracle exactly
(three seeds × 120 operations, ~25k assertions per run). The properties it
pins, several of them fixed by building it:

- **Brands survive every write path.** Entity identity rides a
  brand-preserving structural-sharing pass, so patching twice, refetching,
  hydrating from SSR, and even spreading an entity inside an `optimistic:`
  updater (`{ ...doc, title }` — the brand recovers when the key field
  matches) all keep the entity in the index. `structuredClone`d values held
  outside the cache stay inert — the WeakMap doesn't travel.
- **Patches never launder staleness.** A patch is entity-partial: it leaves
  the freshness clock and any pending invalidation exactly as they were, so
  a list created-into while unmounted still refetches its membership on
  remount, patch or no patch.
- **Rollback is entity-scoped.** Rolling back one entity's optimistic patch
  never erases a later confirmed write to a different entity in the same
  query — no whole-query snapshots.
- **In-flight responses can't regress a patch.** A refetch racing a patch is
  cancelled and the query reconciled — the stale response never lands on top
  of fresher entity state.
- **Subscription events patch caches.** A live event's decoded entities
  drive the same write-through as a mutation output: the header updates when
  the stream says so.
- **Racing mutation responses apply in arrival order** (no versions exist on
  the wire). For contended entities, `touch` or `invalidateEntity` reconciles
  — a refetch always converges. Documented semantics, pinned by test.

## A model is not a view

This is the one rule in the entity system that exists for **security**, not
ergonomics:

> A model is the full truth about a row. An output ships one audience's view of
> it. A model never reaches an output un-scoped.

```ts
export const User = defineModel("user", {
  key: "id",
  shape: {
    id: wire.string,
    name: wire.string,
    email: wire.string,
    latestLat: wire.number,
    latestLng: wire.number,
  },
});

// Name the audiences once, beside the model.
export const UserRef = User.pick("id", "name"); // a mention
export const UserCard = User.pick("id", "name", "avatarUrl"); // a card
export const UserSelf = User.all("the viewer is the subject of this record");
```

```ts
friends.output(wire.array(UserCard)); // can only ever ship three fields
me.output(UserSelf); // wide, and it says why
```

**Why it is not merely style.** The dangerous version of this bug is not
picking the wrong field today — that is visible in the diff of the endpoint
that leaks. It is someone adding `latestLat` to the model _next month_ for the
profile page, and every output that consumed the whole model silently
beginning to ship it. That leak appears in a diff which does not touch the
leaking endpoint, so no reviewer of that change is looking at your friend
list, and no test fails. A per-output allowlist cannot widen retroactively,
which closes the entire class.

Three forms, in order of how often you should reach for them:

| Form                  | Use it for                                                    |
| --------------------- | ------------------------------------------------------------- |
| `Model.pick("id", …)` | the flat 80% case; the key field is mandatory                 |
| `Model.select({ … })` | nesting and computed fields (below)                           |
| `Model.all("why")`    | genuinely every field — costs a sentence that lands in review |

`select` takes one flat map: `true` for the model's own fields, a **codec** for
anything nested or computed, so relationships and one-off aggregates read
alike and every level keeps entity identity:

```ts
export const HotelCard = Hotel.select({
  id: true,
  name: true,
  topReviewer: UserCard, // another model's view — still patches
  recentReviews: wire.array(ReviewRow), // to-many
  reviewCount: wire.number, // computed, not a column
});
```

Be clear-eyed about what this buys: **selection is not authorization.** Picking
`latestLat` into a friend list is still a leak; the type system cannot know who
is looking. What it guarantees is that every widening is a local, visible,
reviewable act instead of an invisible consequence of an edit somewhere else.

Two supporting properties make the guarantee hold end to end. The explicit
model shape asks _may this field ever cross the wire_; `.pick()` at the output
asks _does this endpoint ship it_. An optional `$satisfies<Source>()` proof
catches upstream type drift without widening either allowlist. At the cache
layer, a patch only overwrites keys a row **already holds**, so a mutation
returning `UserSelf` cannot add coordinates to a cached `UserCard` row.

## When to mint a model (and when never to)

The system is opt-in **per node, not per query** — there is no gate where a
shape must be classified. Every new query starts life as one-off
`wire.object`s, exactly like the tRPC output you'd have written anyway. Mint
a model when you notice recurrence, and apply one rule: **will a mutation
somewhere else ever need to update this field on this screen without a
refetch?** No → leave it a one-off. Yes → model the keyed core, and
only its _context-free_ fields — values that are true about the entity in
every query (`name`, `phone`), never values relative to the query's input (a
`minAvailable` computed over the requested date range lives in the
surrounding one-off shape, where it is immune to patching by construction).

There is no demotion event. Aggregates never enter models, so a new
aggregate can never break one — compose (`{ order: Order.pick("id"),
rank }`) or skip the model for that query; both are correct. The asymmetry
is the point: **under-modeling costs nothing** (an unmodeled node degrades
to exactly the invalidate-and-refetch world you already live in), and
over-modeling is bounded by the context-free rule. Relationships are never
declared — they live in each query's output shape, discovered per result by
walking, so there is no relation schema to keep in sync.

`examples/08-bookings/NOTES.md` applies these rules to real-world
shapes — a four-level relational tree, locale-variant content under a
composite key, query-relative aggregates, derived summaries — with a table
justifying every single node as model, pick, or one-off, and request
counters proving each choice.

## What this deliberately is not

There is no normalized store. Per-query results stay the source of truth —
denormalized, exactly typed — with an identity index over them. The
store-as-source-of-truth design (Graphcache, Apollo) exists to serve
flexible queries and would trade away exact per-procedure output types,
which everything else here is built on. Permanent non-goal.

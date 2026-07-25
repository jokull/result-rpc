# 08-bookings: the ground-truth proof

The thesis: result-rpc's entity system works on **real-world query shapes** —
a four-level relational tree with column subsets at every level, localized
content under composite keys, aggregates relative to the query input, and
derived summaries — against a **real database** (Drizzle ORM 1.0 over
bun:sqlite, raw DDL at seed time, no drizzle-kit). Every claim is pinned by a
per-procedure request counter, not a screenshot.

## Every output shape, and why each node is what it is

| Output node | Declared as | Why |
| --- | --- | --- |
| `orders.list` row wrapper `{ order, lineItems }` | one-off `wire.object` | The *pairing* is query shape, not a fact about anything. Inline objects collect no identity — deliberately. |
| `order` | `Order.codec` (model) | `id`/`email`/`note` are context-free: true in every query that mentions the order. `setNote` returns `Order.pick("id","note")` and the tree's order node patches in place. |
| line item `{ id, date, nights, destinations }` | one-off | It has an id but nothing ever patches it by identity here; its `date` is moved by `reschedule`, which is *declared* freshness (`.affects`), not identity patching. |
| destination `{ idx, nights, hotel, rooms }` | one-off wrapping a model | `idx`/`nights` describe the itinerary position, not the hotel. The `hotel` inside is `Hotel.pick("id","name","phone")` — the entity node at depth 4 that `updatePhone` patches with zero refetches. |
| room `{ description, board, occupants }` | one-off | Display-only composition; no mutation addresses a room. |
| occupant `{ firstName, lastName }` | one-off, **deliberately unkeyed** | The real-world leaf: display-only name pairs with no id at all. Nothing patches them; nothing should. |
| `hotels.byId` | `Hotel.codec` | Canonical entity — the front-desk panel and the tree share one identity, which is the whole flagship proof. |
| `tours.byId` / `tours.featured` rows | `TourContent.codec`, key `["id","locale"]` | The locale trap, closed structurally: `(t-fuji, en)` and `(t-fuji, ja)` are *different entities*. A single-field `id` key would smear an English title edit into the Japanese cache. |
| `availability.search` row `{ tour, minAvailable }` | one-off around `TourContent.pick("id","locale","title")` | `minAvailable` is a `min()` over the **input** date range — the same tour holds different numbers in two searches. Query-relative values live in the surrounding one-off shape, immune to patching *by construction*; the `tour` node inside still patches by identity. |
| `profile.nextDeparture` | one-off union (`upcoming`/`none`) | Fully derived (earliest upcoming date + a resolved hotel name); contains **no entity**, so no identity patch can ever fresh it. Its freshness is `.affects(nextDeparture)` on `reschedule` — derived summaries are `.affects` territory. |
| `orders.reschedule` output `{ order: Order.pick("id"), date }` | pick + one-off | The pick names *who* changed (a no-op patch, but an honest identity); the moved `date` lives in one-off shapes in two queries, so the contract declares both refetches. |
| `tours.retire` output `{ removed }` | one-off scalar | Deleted entities cannot be returned — the handler `touch`es both composite keys instead, one per locale entity. |

## What the counters pin (per test)

1. **Deep tree round-trip** — the direct client returns the exact 4-level
   tree from real SQL, column subsets and all (`chargedAt` and every FK
   column exist in the tables and never reach the wire).
2. **Flagship** — `updatePhone` = `{ ...baseline, "hotels.updatePhone": 1 }`:
   the phone changes at depth 4 in *two* tree occurrences and in the desk
   query; zero refetches. Then `setNote` patches the order node the same way.
3. **Locale trap** — with the server gated, the optimistic
   `cache.updateEntity(TourContent, { id, locale: "en" }, …)` (record-key
   API) lands on the en detail *and* the en featured row while the ja detail
   is untouched; counts end `{ ...baseline, "tours.editTitle": 1 }`.
4. **Query-relative aggregates** — one rename patches `tour.title` in both
   search panels; each keeps its own `minAvailable` (2 vs 4); still exactly
   one request.
5. **Derived summary** — `reschedule` = mutation + exactly one
   `profile.nextDeparture` refetch (recomputed: new date, new resolved hotel)
   + one `orders.list` refetch for the one-off `date` in the tree.
6. **`touch` with a record key** — `retire` deletes both locale rows and
   touches `(t-fuji, en)` and `(t-fuji, ja)`; the two detail queries refetch
   into their honest `tours/not-found` arcs, featured(en) refetches once, and
   both availability searches refetch (their rows embed the en projection):
   `{ ...baseline, retire: 1, byId: +2, featured: +1, search: +2 }`.

## Drizzle 1.0 friction (vs 0.x, worth knowing)

- **Relations are a separate v2 system.** The 0.x per-table
  `relations(table, ({ one, many }) => …)` helper is gone from the main
  entry; you write one `defineRelations(schema, (r) => …)` over the whole
  schema and pass it as `drizzle({ client, relations })` (the `schema` config
  key is not how RQB is wired anymore). Relation endpoints are `from`/`to`
  column pairs (`r.many.lineItems({ from: r.orders.id, to: r.lineItems.orderId })`)
  instead of `fields`/`references`.
- **`one()` is optional by default.** Without `optional: false` the nested
  `hotel` types as `Hotel | null` even when the FK is `NOT NULL` — set it or
  every consumer null-checks a guaranteed row.
- **RQB filters are objects, not callbacks.** `where: { locale: "en" }`,
  `where: { date: { gte: today } }`, `orderBy: { idx: "asc" }` — the 0.x
  `(table, { eq }) => eq(...)` callback form is gone. Shorthand equality
  (`{ id, locale }`) works for composite-PK lookups. `db.select()` builders
  still use the operator functions (`and`, `gte`, `min`, `groupBy`).
- **The big one: nested `with` on SQLite emits `jsonb_*` functions**, which
  require SQLite >= 3.45 — and Bun on macOS links the *system* SQLite
  (3.43 here), so every nested relational query dies with
  `no such function: jsonb_object`. The fix lives in `world.ts`:
  `Database.setCustomSQLite(<homebrew libsqlite3>)` before the first
  `Database` is constructed, plus a version check with a real error message.
  Linux Bun bundles a modern SQLite and is unaffected. We kept the relational
  query builder for the deep tree (it maps 1:1 onto the output codec and
  proves the v2 API); the `select().leftJoin()` fallback was not needed.
- **`min()` types as `number | null`** even under `groupBy` where a group
  always has rows — the handler filters the null arm to satisfy the codec.
- Pleasant surprise: the RQB result shape (`columns` subset + `with` keys)
  matches the one-off wire codecs *exactly*, so only the root row needs
  restructuring (`{ lineItems, ...order } → { order, lineItems }`); every
  nested level passes through untouched, fully typed.

## Library friction (DX probe, honest)

- None blocking. The record-key surfaces (`defineModel` composite `key`,
  `cache.updateEntity(Model, { id, locale }, …)`, `touch(Model, { id, locale })`)
  all accept the same `ModelKeyInput` and behaved exactly as documented.
- The projection rule earns its keep here: `updatePhone` returns the full
  `Hotel` (with `city`), and the depth-4 `pick("id","name","phone")` nodes
  merge only the fields they carry — no shape corruption, no manual mapping.
- One discipline to internalize: the counter tests only stay honest because
  every patchable node is composed from a model codec. The unkeyed occupant
  leaf is the counter-example on purpose — inline objects opt out silently,
  which is exactly the documented contract.

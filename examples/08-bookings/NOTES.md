# 08-bookings: the ground-truth proof

The thesis: result-rpc's entity system works on **real-world query shapes** —
a four-level relational tree with column subsets at every level, localized
content under composite keys, offset-paginated feeds, aggregates relative to
the query input, and derived summaries — against a **real database** (Drizzle
ORM 1.0 over bun:sqlite, raw DDL at seed time, no drizzle-kit). And that what
entities buy (free client state updates) is worth what they cost. Every model
is an explicit browser-safe wire contract checked against its Drizzle select
type with `$satisfies<Source>()`; every runtime claim is pinned by a
per-procedure request counter, not a screenshot.

## Every output shape, and why each node is what it is

| Output node                                                    | Declared as                                              | Why                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders.list` row wrapper `{ order, bookedBy, lineItems }`     | one-off `wire.object`                                    | The _pairing_ is query shape, not a fact about anything. Inline objects collect no identity — deliberately.                                                                                                                                                                               |
| `order`                                                        | `Order.all(...)` (source-checked model)                  | `id`/`email`/`note` are context-free: true in every query that mentions the order. `setNote` returns `Order.pick("id","note")` and the tree's order node patches in place.                                                                                                                |
| `bookedBy`                                                     | `User.pick("id","name")`                                 | The booking user is an entity: `users.rename` patches this line in the tree without the tree ever being refetched.                                                                                                                                                                        |
| line item `{ id, date, nights, destinations }`                 | one-off                                                  | It has an id but nothing ever patches it by identity here; its `date` is moved by `reschedule`, which is _declared_ freshness (`.affects`), not identity patching.                                                                                                                        |
| destination `{ idx, nights, hotel, rooms }`                    | one-off wrapping a model                                 | `idx`/`nights` describe the itinerary position, not the hotel. The `hotel` inside is `Hotel.pick("id","name","phone")` — the entity node at depth 4 that `updatePhone` patches with zero refetches.                                                                                       |
| room `{ description, board, occupants }`                       | one-off                                                  | Display-only composition; no mutation addresses a room.                                                                                                                                                                                                                                   |
| occupant `{ firstName, lastName }`                             | one-off, **deliberately unkeyed**                        | The real-world leaf: display-only name pairs with no id at all. Nothing patches them; nothing should.                                                                                                                                                                                     |
| `hotels.byId`                                                  | `Hotel.all(...)`                                         | Canonical entity — the front-desk panel and the tree share one identity, which is the whole flagship proof.                                                                                                                                                                               |
| `hotels.reviews` page `{ rows, hasMore }`                      | one-off                                                  | Page composition and the `hasMore` sentinel are query-relative by definition (they describe _this page of this feed_).                                                                                                                                                                    |
| review row `{ review, author }`                                | one-off around a model                                   | The review object is **deliberately unmodeled** — it has an id, but nothing in the app patches reviews by identity, and an id alone does not make something an entity. The `author` is `User.pick("id","name","avatarUrl")` — that is what makes a rename cross page boundaries for free. |
| `hotels.reviewStats` `{ count, averageRating }`                | one-off                                                  | A `count()`/`avg()` aggregate over a table is a fact about the _query_, not about any row. Freshened by `.affects`, never by patching.                                                                                                                                                    |
| `tours.byId` / `tours.featured` rows                           | `TourContent.all(...)`, key `["id","locale"]`            | The locale trap, closed structurally: `(t-fuji, en)` and `(t-fuji, ja)` are _different entities_. A single-field `id` key would smear an English title edit into the Japanese cache.                                                                                                      |
| `availability.search` row `{ tour, minAvailable }`             | one-off around `TourContent.pick("id","locale","title")` | `minAvailable` is a `min()` over the **input** date range — the same tour holds different numbers in two searches. Query-relative values live in the surrounding one-off shape, immune to patching _by construction_; the `tour` node inside still patches by identity.                   |
| `profile.nextDeparture`                                        | one-off union (`upcoming`/`none`)                        | Fully derived (earliest upcoming date + a resolved hotel name); contains **no entity**, so no identity patch can ever fresh it. Its freshness is `.affects(nextDeparture)` on `reschedule` — derived summaries are `.affects` territory.                                                  |
| `orders.reschedule` output `{ order: Order.pick("id"), date }` | pick + one-off                                           | The pick names _who_ changed (a no-op patch, but an honest identity); the moved `date` lives in one-off shapes in two queries, so the contract declares both refetches.                                                                                                                   |
| `reviews.add` output `{ review, author }`                      | one-off + pick                                           | The mixed mutation: the `author` entity patches by identity while membership (all cached pages) and the aggregate ride the mutation's two map-less `.affects` declarations.                                                                                                               |
| `tours.retire` output `{ removed }`                            | one-off scalar                                           | Deleted entities cannot be returned — the handler `touch`es both composite keys instead, one per locale entity.                                                                                                                                                                           |

## What the counters pin (per test)

1. **Deep tree round-trip** — the direct client returns the exact 4-level
   tree from real SQL, column subsets and all (`chargedAt`, `userId`, and
   every FK column exist in the tables and never reach the wire).
2. **Flagship** — `updatePhone` = `{ ...baseline, "hotels.updatePhone": 1 }`:
   the phone changes at depth 4 in _two_ tree occurrences and in the desk
   query; zero refetches. Then `setNote` patches the order node the same way.
3. **Locale trap** — with the server gated, the optimistic
   `cache.updateEntity(TourContent, { id, locale: "en" }, …)` (record-key
   API) lands on the en detail _and_ the en featured row while the ja detail
   is untouched; counts end `{ ...baseline, "tours.editTitle": 1 }`.
4. **Query-relative aggregates** — one rename patches `tour.title` in both
   search panels; each keeps its own `minAvailable` (2 vs 4); still exactly
   one request.
5. **Derived summary** — `reschedule` = mutation + exactly one
   `profile.nextDeparture` refetch (recomputed: new date, new resolved hotel)
   - one `orders.list` refetch for the one-off `date` in the tree.
6. **`touch` with a record key** — `retire` deletes both locale rows and
   touches `(t-fuji, en)` and `(t-fuji, ja)`; the two detail queries refetch
   into their honest `tours/not-found` arcs, featured(en) refetches once, and
   both availability searches refetch (their rows embed the en projection):
   `{ ...baseline, retire: 1, byId: +2, featured: +1, search: +2 }`.
7. **Cross-page pagination (the headline)** — with Okura pages 1 AND 2 plus
   a Granvia page mounted, `users.rename` = `{ ...baseline, "users.rename": 1 }`
   while the author's name updates on **four surfaces**: a row on Okura
   page 2, a row on Granvia page 1, the top-reviewer card, and the orders
   tree's booked-by line. (The round-three UNIQUE(hotel, author) constraint
   means one author can never hold two rows in a single hotel's feed — so
   the proof spans pages of two feeds, which is the same mechanism:
   pagination does not defeat identity freshness, because pages are just
   more cached queries containing the same entities.)
8. **Mixed mutation blast radius** — with page 2 cached but collapsed,
   `reviews.add` = `{ ...baseline, add: 1, "hotels.reviews": +1,
"hotels.reviewStats": +1 }`: the ACTIVE page refetches (new review at the
   top, membership shifted), the aggregate refetches (4.2 → 3.8), and the
   inactive cached page is invalidated _without_ being fetched — it fetches
   fresh membership exactly once on its next mount. The same test then posts
   a DUPLICATE review: the UNIQUE constraint fires, `tryDb` surfaces
   `db/unique-violation`, the handler collapses it to
   `reviews/already-reviewed`, and counts prove exactly one request with
   zero invalidation side effects (`.affects` fires only on success).

## The cost ledger

What the freshness in tests 2 and 7 actually costs to _declare_, counted in
real lines.

**Here, the model declaration is deliberately explicit.** Each public field
names its wire codec and identity in `models.ts`; the chained
`$satisfies<typeof table.$inferSelect>()` proves that the selected fields have
not drifted from Drizzle. Private table columns are allowed as source extras
and cannot silently widen the wire. The type-only table imports are erased,
so the client bundle contains neither Drizzle nor table metadata.

Per mutation, the client-freshness code is **zero lines** — `updatePhone`,
`setNote`, `users.rename` are bare `mutate()` calls; `reviews.add` adds two
`.affects` lines _in the contract, once_.

**The same freshness in tRPC + React Query, counting their real code (the
disciplined `setQueryData` version, not a strawman):**

- `updatePhone` reaching 3 surfaces (tree ×2 occurrences + desk):
  - `onSuccess` handler ceremony: ~2 lines
  - `setQueryData(['hotels','byId',{id}], …)`: ~3 lines
  - `setQueryData(['orders','list'], …)` walking rows → lineItems →
    destinations → hotel and rebuilding immutably: ~12 lines, and it
    silently breaks the next time the tree shape changes
  - **~17 lines per mutation, forever** — or the lazy version,
    2 × `invalidateQueries` = 2 extra network round-trips per phone edit.
- `users.rename` reaching 4 surfaces across 2 _pages_:
  - `setQueriesData({ queryKey: ['hotels','reviews'] }, …)` with partial-key
    matching over every cached `{hotelId, page}` input, mapping rows: ~10
    lines
  - `setQueryData(['users','byId',{id}], …)`: ~3 lines
  - `setQueryData(['orders','list'], …)` for the booked-by node: ~7 lines
  - **~20 lines** — or 3+ invalidations = one refetch _per cached page_ per
    rename.
- And each block above is duplicated (or extracted and imported) at **every
  call site that uses the mutation**, because React Query updaters attach to
  `useMutation` options, not to the operation. Two screens with a rename
  button = two copies, or a hand-rolled sharing convention.

The trade in one sentence: result-rpc asks for one explicit model per shared
entity, checked against its source type, and gives back every
`onSuccess`/`invalidateQueries`/`setQueryData` block those mutations would
otherwise carry, at every call site, for the life of the app.

### Addendum: the pre-check SELECT vs `tryDb`

Round three replaced `reviews.add`'s validity checks with constraints +
`tryDb` (the ORM-independent Result boundary in `result-rpc/db`), and the
ledger entry is stark:

- **Pre-check idiom (before):** SELECT the hotel (1 round trip, 4 lines),
  and to enforce "one review per user per hotel" it would have needed a
  second SELECT (1 more round trip, ~5 lines) — **and it still loses**: two
  concurrent submits both pass the SELECT and both insert. The check and
  the write are different statements; the race lives between them.
- **`tryDb` (after):** attempt the INSERT — one statement, zero extra round
  trips. `db/unique-violation` collapses to the declared
  `reviews/already-reviewed`, `db/foreign-key-violation` (the hotel id is
  the only client-supplied reference) collapses to `hotel/not-found`, and
  the remaining `db/*` arms rethrow as defects. The insert IS the check, so
  the race is not narrowed — it is deleted; the database serializes it.
- Doctrine held: `db/*` tags are server-side composition currency (all
  `visibility: "private"`), never declared in `.errors()` — `matchError` at
  the handler boundary is where driver vocabulary becomes domain vocabulary.
- Pinned by test: the duplicate attempt costs exactly **one** request
  (`{ ...afterFirst, "reviews.add": +1 }`) — no client pre-check round trip,
  and no invalidation side effects, because `.affects` fires only on
  success; the feed and the stats aggregate are byte-identical after the
  failure.

## Pagination and entities

The finding from test 7: **offset pages are just cached queries.** Page 1 and
page 2 of a hotel's reviews are two entries in the same cache, each indexed
by the entities their rows embed. `users.rename` returns a `User`, and the
runtime patches _every query containing `user:u-kenji`_ — it has no concept
of "page", so page boundaries cannot stop it. Identity freshness crosses
pages for free; nothing was built to make this work.

Membership is the half that pages make interesting, and it goes through
`.affects` — deliberately **map-less** on the paginated list, because a page
input makes a mapped target awkward (which pages did an insert shift? all of
them at and after the insertion point — i.e., you cannot know from the
input). Map-less `.affects` invalidates every cached input of the target;
only ACTIVE pages actually refetch, and a collapsed page fetches fresh
membership exactly once on its next mount (pinned in test 8). The blast
radius is declared once in the contract, visible in the same diff that adds
the mutation.

**Not built, on purpose: cursor-feed splicing** (Relay-style
`connection`/edge insertion into cursor windows). A census of a 280-procedure
production API found **zero** cursor feeds — every paginated surface was
offset/page-number shaped, exactly what `hotels.reviews` models. Splicing
machinery would be complexity spent on a shape the data says doesn't occur;
if a real infinite feed ever demands it, the entity index (field freshness)
and `.affects` (membership) already draw the correct boundary around it.

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
  still use the operator functions (`and`, `gte`, `min`, `avg`, `groupBy`).
- **The big one: nested `with` on SQLite emits `jsonb_*` functions**, which
  require SQLite >= 3.45 — and Bun on macOS links the _system_ SQLite
  (3.43 here), so every nested relational query dies with
  `no such function: jsonb_object`. Drizzle already carries a `forbidJsonb`
  flag for exactly this class of driver (its Expo and Durable Object drivers
  set it, downgrading to `json_*`, in SQLite since 3.38 with identical
  results) — but the bun-sqlite driver does not expose it. The fix in
  `world.ts` flips the flag on the per-table query builders after
  `drizzle()` constructs them. First attempt was Bun's
  `Database.setCustomSQLite(<homebrew libsqlite3>)`, which works in
  isolation but may be called only before _anything_ in the process opens a
  database — unownable in a shared test process, and it broke the moment
  another test file opened a raw `Database` first. We kept the relational
  query builder for the deep tree (it maps 1:1 onto the output codec and
  proves the v2 API); the `select().leftJoin()` fallback was not needed.
- **`min()` types as `number | null`, `avg()` as `string | null`**
  (decimal-as-string) even under `groupBy` where a group always has rows —
  handlers filter the null arm and parse the average before the codec sees
  it.
- Pleasant surprise: the RQB result shape (`columns` subset + `with` keys)
  matches the one-off wire codecs _exactly_, so only the root row needs
  restructuring (`{ lineItems, user, ...order } → { order, bookedBy, lineItems }`);
  every nested level passes through untouched, fully typed. The same holds
  for review rows (`{ author, ...review } → { review, author }`).

## Source-proof friction (honest)

- **Identity is not derivable from a TypeScript row.** Composite identity is
  therefore explicit: `TourContent` names `key: ["id", "locale"]`.
- **The enum check surfaced a real drift.** The wire contract declared a
  literal locale union while the table originally said plain `text`. The
  `$satisfies` call failed until the schema used
  `text("locale", { enum: ["en", "ja"] })`.
- **Nullability is checked exactly.** `users.avatarUrl` is nullable, so its
  public codec explicitly accepts `string | null`; either side drifting is a
  type error.
- **Codecs remain a contract decision.** The proof checks TypeScript shape;
  it does not infer runtime validation, refinements, identity, or database
  constraints.

## Library friction (DX probe, honest)

- None blocking. The record-key surfaces (composite `key`,
  `cache.updateEntity(Model, { id, locale }, …)`, `touch(Model, { id, locale })`)
  all accept the same `ModelKeyInput` and behaved exactly as documented.
- The projection rule earns its keep here: `updatePhone` returns the full
  `Hotel` (with `city`), and the depth-4 `pick("id","name","phone")` nodes
  merge only the fields they carry — no shape corruption, no manual mapping.
  Same story for `users.rename` (full `User` with `avatarUrl`) landing on
  the tree's `pick("id","name")` nodes.
- One discipline to internalize: the counter tests only stay honest because
  every patchable node is composed from a model codec. The unkeyed occupant
  leaf and the unmodeled review row are the counter-examples on purpose —
  inline objects opt out silently, which is exactly the documented contract.

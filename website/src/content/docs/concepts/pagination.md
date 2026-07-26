---
title: "Pagination"
description: "Cursor pagination that stays one cache entry per list — every page patched by entity identity, no manual page-splicing."
---

Most pagination libraries make you choose between two bad options: refetch the
whole list after every mutation, or hand-splice rows into cached pages and hope
your indices line up. result-rpc does neither. A paginated query is **one cache
entry per list**, and the entity cache patches rows across all loaded pages the
same way it patches everything else — by identity, at exactly one request.

## Declaring a paginated query

`.paginate()` finishes a query builder the way `.query()` does, but it reshapes
both ends of the wire. `.output()` declares the **row** codec; `.paginate()`
wraps it in the page envelope and splits the input into list identity and
cursor:

```ts
const feed = rpc
  .procedure()
  .input(wire.object({ q: wire.string }))   // the list identity
  .output(Message.codec)                     // ONE row
  .paginate({ cursor: wire.string })         // cursor codec
```

On the wire the input becomes `{ list: { q }, cursor: string | null }` and the
output becomes `{ items: Message[], nextCursor: string | null }`. The handler
returns one page; `nextCursor: null` means "this is the last page":

```ts
const feed = rpc
  .procedure()
  .input(wire.object({ q: wire.string }))
  .output(Message.codec)
  .paginate({ cursor: wire.string }, async ({ input, context }) => {
    const after = input.cursor ?? undefined
    const rows = await context.db.messages.page({ q: input.list.q, after, limit: 20 })
    return ok({
      items: rows.slice(0, 20),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    })
  })
```

The cursor is opaque to the framework — a row id, an offset, a keyset tuple,
whatever your storage wants. It only has to survive the codec you declared.

## Consuming it

```tsx
function Feed({ q }: { q: string }) {
  const feed = useResultPaginatedQuery(client.feed, { q })

  if (feed.state === "pending") return <Spinner />
  if (feed.state === "failure") return null   // a shell owns it — see below

  return (
    <>
      {feed.rows.map((message) => <Row key={message.id} message={message} />)}
      {feed.hasNext && (
        <button onClick={feed.fetchNext} disabled={feed.fetchingNext}>
          Load more
        </button>
      )}
    </>
  )
}
```

`rows` is every loaded page flattened into one list. `fetchNext()` loads the
next page and appends it; `hasNext` falls straight out of the last page's
`nextCursor`. The failure branch narrows and claims exactly like
`useResultQuery` — an enclosing [shell](/concepts/shells/) can own a paginated
query's error, and the hook shows the previous rows while the shell decides.

## Why one cache entry matters

The list input keys the cache; the cursor never does. Every page of one list
lives under a single entry, and three things follow for free:

- **Entity patches reach every page.** A mutation that returns a `Message`
  entity patches that row wherever it sits — page one or page nine — at one
  request, no refetch. The same [entity](/concepts/entities/) machinery that
  patches a detail view and a list row patches paginated rows, because a
  paginated list is just more cached rows.
- **`.affects()` targets the whole list.** A mutation declaring
  `.affects(feed)` invalidates the list with its list-shaped input — you never
  name a cursor. Invalidation converges every loaded page.
- **`refetch()` converges the window.** Refetching replays every loaded page
  in sequence — each page's cursor comes from the previous page's fresh
  response — so the whole loaded window re-verifies, not just page one.

## Rows are deduplicated by identity

Between two fetches, an insert or delete can slide a row across a page
boundary, so the same entity would appear on two pages. `rows` deduplicates by
entity identity: the first occurrence wins its position, and because field
freshness is identity-driven, the dropped copy loses nothing — a patch reaches
the retained row regardless of which page carried it.

## Set a `staleTime` for stable lists

An actively-observed list with the default `staleTime` of `0` re-verifies its
loaded pages whenever the cache is written — correct convergence, but usually
more than you want for a scroll position the user is reading. Give long-lived
lists a `staleTime`:

```tsx
useResultPaginatedQuery(client.feed, { q }, { staleTime: 60_000 })
```

With a stale window, a mutation that patches a visible row does so in place at
exactly one request — the row updates, the scroll position holds, nothing
refetches.

## Prefetching

`runtime.prefetchPaginated(client.feed, { q })` warms the first page — use it
in a router loader or during SSR, exactly like `prefetch` for unary queries.
Hydrated pages are normalized through the row codec on the way in, so their
entities index and patch even before a component observes the list.

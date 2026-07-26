---
title: "React Server Components"
description: "Prefetch on the server, hydrate into the client cache — no loading flash, no waterfall, and server-rendered rows a client mutation still patches by identity."
---

result-rpc renders on the server the way it renders anywhere: prefetch queries
into a runtime, dehydrate that runtime to a plain serializable value, and let a
client boundary merge it. The payoff is the full one — not just a filled cache,
but **entities that are indexed on hydrate**, so a client mutation patches a
server-rendered row in place with no refetch.

## The shape

Three steps, each a value crossing one boundary:

1. **Server**: a per-request runtime over an in-process [server
   client](/guides/testing/#the-parity-client) prefetches queries.
2. **Boundary**: `runtime.dehydrate()` returns `{ v, serializer, payload }` — a
   plain object with a string payload, so it crosses the RSC server→client
   boundary as an ordinary prop.
3. **Client**: `<ResultRpcHydrationBoundary state={...}>` merges it into the one
   client runtime, during render, before the first paint reads the cache.

```tsx
// app/rsc.ts — one runtime per request, shared by every server component
import { cache } from "react"
import { createServerClient } from "result-rpc/server"
import { createQueryRuntime } from "result-rpc/query"   // ← react-free entry
import { appRouter } from "@app/server"      // server-only module

export const getServerRuntime = cache(() => {
  const client = createServerClient(appRouter, { mode: "parity", context: buildContext() })
  return createQueryRuntime({ client })
})
```

:::note[Two entries: `result-rpc/query` on the server, `result-rpc/react` in components]
`result-rpc/react` is marked `"use client"`. Rendering its **components** from a
server component is fine and expected — `<ResultRpcHydrationBoundary>` below is
imported straight into a server component, and the bundler turns it into a
client reference rather than executing it on the server. That is the boundary
working as designed.

What you cannot do is *call* its non-component exports on the server: a
react-server environment will not evaluate a client module, so
`createQueryRuntime` imported from `result-rpc/react` fails there. The cache
runtime has no React dependency at all, so it ships as its own entry — import
`createQueryRuntime` and its types from **`result-rpc/query`** in server code.
:::

`cache()` (React's per-request memo) means every server component in one request
shares a runtime — prefetches accumulate, and you dehydrate once at the boundary.

```tsx
// app/users/[id]/page.tsx — a server component
import { getServerRuntime } from "@app/rsc"
import { serverClient } from "@app/rsc"
import { ResultRpcHydrationBoundary } from "result-rpc/react"
import { UserDetail } from "./user-detail"   // a client component

export default async function Page({ params }: { params: { id: string } }) {
  const runtime = getServerRuntime()
  await runtime.prefetch(serverClient.users.get, { id: params.id })
  return (
    <ResultRpcHydrationBoundary state={runtime.dehydrate()}>
      <UserDetail id={params.id} />
    </ResultRpcHydrationBoundary>
  )
}
```

```tsx
// user-detail.tsx — a client component
"use client"
import { useResultQuery } from "result-rpc/react"
import { client } from "@app/client"

export function UserDetail({ id }: { id: string }) {
  // Already `success` on first paint — the server prefetched it.
  const user = useResultQuery(client.users.get, { id }, { staleTime: 60_000 })
  if (user.state !== "success") return <UserSkeleton />
  return <h1>{user.value.name}</h1>
}
```

The `ResultRpcProvider` still wraps your app once (usually in the root layout's
client boundary), owning the client runtime. The hydration boundary feeds it.

## Set a `staleTime` on prefetched queries

Server-prefetched data arrives with the timestamp it was fetched. With the
default `staleTime` of `0` it is immediately stale, so the client revalidates in
the background on mount — correct, but a wasted round-trip when you just rendered
it. Give prefetched queries a `staleTime` so the server data is trusted for a
window and the first mount makes **zero** client requests. That is the whole
point of prefetching: no loading flash *and* no immediate refetch.

## Nested boundaries merge

Unlike the provider's one-shot `hydrate` prop, boundaries are **nestable** — the
App Router idiom. Each route segment's server component prefetches only what it
owns and renders its own boundary; every payload merges into the one client
runtime:

```tsx
<ResultRpcHydrationBoundary state={layoutRuntime.dehydrate()}>
  <Nav />
  <ResultRpcHydrationBoundary state={pageRuntime.dehydrate()}>
    <Content />
  </ResultRpcHydrationBoundary>
</ResultRpcHydrationBoundary>
```

## The entity payoff

Hydrated queries are indexed in the [entity cache](/concepts/entities/) exactly
as fetched ones are — the dehydrated data is re-decoded through each output
codec on hydrate, which re-brands its entities. So a server-rendered user row
and a client mutation that returns that same `user` entity are connected: the
mutation patches the row in place, at one request, with no refetch — even though
no client component ever fetched it. Server rendering does not cost you the
live-update behavior; it seeds it.

## Deploy skew is survived, not crashed

If the server and client bundles briefly disagree on the serializer or contract
version across a deploy, the boundary **skips** hydration (with a dev warning)
and the client fetches fresh, rather than throwing during render and taking down
the tree. A stale server payload never renders as if it were current.

[`08-bookings`](/reference/examples/#08-bookings) and the Waku kitchen-sink
example exercise this end to end — prefetched paginated feeds, skeleton
fallbacks, and mutations patching server-rendered rows.

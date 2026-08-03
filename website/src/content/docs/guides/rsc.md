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

1. **Server**: a per-request runtime over an in-process server client prefetches
   queries.
2. **Boundary**: `runtime.dehydrate()` returns `{ v, serializer, contract, payload }` — a
   plain object with a string payload, so it crosses the RSC server→client
   boundary as an ordinary prop.
3. **Client**: `<ResultRpcHydrationBoundary state={...}>` merges it into the one
   client runtime, during render, before the first paint reads the cache.

```tsx
// app/rsc.ts — one runtime per request, shared by every server component
import { cache } from "react";
import { createServerClient } from "result-rpc/server";
import { createQueryRuntime } from "result-rpc/query"; // ← react-free entry
import { appRouter } from "@app/server"; // server-only module

export const getServerRpc = cache(() => {
  const client = createServerClient(appRouter, { context: buildContext() });
  return { client, runtime: createQueryRuntime({ client }) };
});
```

> **Two entries: `result-rpc/query` on the server, `result-rpc/react` in
> components.** `result-rpc/react` is marked `"use client"`. Rendering its
> **components** from a server component is fine and expected —
> `<ResultRpcHydrationBoundary>` below is imported straight into a server
> component, and the bundler turns it into a client reference rather than
> executing it on the server. That is the boundary working as designed.
>
> The cache runtime has no React dependency, so it ships as its own entry.
> `createQueryRuntime` is intentionally **not exported** from
> `result-rpc/react`: importing it from a `"use client"` entry can compile yet
> fail when a React server evaluates the call. Import it and its types from
> **`result-rpc/query`** in server code, where the mistake is caught at the
> module boundary instead of on a production request.

`cache()` (React's per-request memo) means every server component in one request
shares a runtime — prefetches accumulate, and you dehydrate once at the boundary.

```tsx
// app/users/[id]/page.tsx — a server component
import { getServerRpc } from "@app/rsc";
import { ResultRpcHydrationBoundary } from "result-rpc/react";
import { UserDetail } from "./user-detail"; // a client component

export default async function Page({ params }: { params: { id: string } }) {
  const { client, runtime } = getServerRpc();
  await runtime.prefetch(client.users.get, { id: params.id });
  return (
    <ResultRpcHydrationBoundary state={runtime.dehydrate()}>
      <UserDetail id={params.id} />
    </ResultRpcHydrationBoundary>
  );
}
```

```tsx
// user-detail.tsx — a client component
"use client";
import { useResultQuery } from "result-rpc/react";
import { client } from "@app/client";

export function UserDetail({ id }: { id: string }) {
  // Already `success` on first paint — the server prefetched it.
  const user = useResultQuery(client.users.get, { id }, { staleTime: 60_000 });
  if (user.state !== "success") return <UserSkeleton />;
  return <h1>{user.value.name}</h1>;
}
```

The `ResultRpcProvider` still wraps your app once (usually in the root layout's
client boundary), owning the client runtime. The hydration boundary feeds it.

## Set a `staleTime` on prefetched queries

Server-prefetched data arrives with the timestamp it was fetched. With the
default `staleTime` of `0` it is immediately stale, so the client revalidates in
the background on mount — correct, but a wasted round-trip when you just rendered
it. Give prefetched queries a `staleTime` so the server data is trusted for a
window and the first mount makes **zero** client requests — no loading flash
and no immediate refetch.

This is browser query freshness, not an HTTP or CDN cache directive. See
[Freshness, fetch state, and backend caching](/concepts/react/#freshness-fetch-state-and-backend-caching)
for the canonical distinction.

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

## Calling procedures on the server

`createServerClient` runs procedures in-process. Use it for server rendering,
server actions, and background jobs. It keeps everything that decides whether a
call is _correct_ — the middleware chain and its context, input validation,
output encode/decode (which also brands entities), and the sanitization of
private errors into `server/internal` — and drops only the transport: no
serializer round trip, no HTTP envelope, no contract digest, no retry, no
batching.

Wire-faithful tests use `createParityClient` from `result-rpc/testing` instead.
That client crosses the serializer, protocol envelope, fetch handler, and
browser decoder so tests prove a value survives the trip.

The constructors also expose different error types:

```ts
// createParityClient / createBrowserClient
DocNotFound |
  Unauthorized |
  ServerInternal |
  ServerBadRequest |
  Offline |
  NetworkFailure |
  Timeout |
  HttpFailure |
  ProtocolViolation |
  DecodeFailure |
  Stale;

// createServerClient — what is actually reachable in-process
DocNotFound | Unauthorized | ServerInternal | ServerBadRequest;
```

The client-boundary tags are gone because they are unreachable, not because
they were hidden: there is no socket to drop, no `navigator` to report offline,
and no second build to drift from. That narrowing is what makes an exhaustive
`matchError` in a server component three arms instead of a dozen.

## Shells do not exist on the server

`result-rpc/react` is a client entry, and claiming is React context. A server
component can render `<ResultRpcHydrationBoundary>` as a client reference, but
it cannot _use_ a shell — and what shells do (pause and resume on reconnect,
redirect to login, hold and drain) only means something in a live browser.

So a server component sees the complete union and handles it itself. You have
three honest options:

1. **Ignore the failure.** Legitimate, and usually right. A declared domain
   failure hydrates (see below), so the browser paints it without asking. A
   transport failure does not, so the client mounts that query cold, fetches
   once, and the shells own the failure _there_ — live, and retryable.
2. **Handle the outcomes that belong to the response.** Some failures deserve a
   server answer: `notFound()` on `doc/not-found`, `redirect("/login")` on
   session expiry, a 500 page on `server/internal`. These are framework
   primitives, and they beat a client shell — right status code, no flash, no
   wasted round trip.
3. **Do not try to reproduce shells.** Pause/resume, offline banners, and
   session-expiry-with-return-to need a client.

The rule of thumb: **server components own the failures that change the HTTP
response; shells own the failures that change the UI.**

> **Mutations from server actions lose the cache.** A mutation called through a
> direct caller executes normally and returns its `Result`, but its cache
> declarations are inert — `.affects()`, entity patching, and `touch` are
> client-runtime behaviors, and there is no client cache on a server. The write
> lands; the browser's cache learns nothing about it. Refresh the route, or
> perform the mutation from the client where the machinery lives.

## Declared failures hydrate; transport failures do not

The split follows from the library's first pillar: **a declared domain error is
a value**, and `dehydrate()` carries values.

`doc/not-found` is not a failed prefetch. It is the answer — the same answer the
client would get, arrived at on the server, and it hydrates like any success. A
detail page for a row that does not exist renders "not found" on **first paint,
at zero client requests**. It comes back reified through the procedure's error
registry, so it narrows, matches, and is [claimed by a
shell](/concepts/shells/) exactly as a live failure would be.

`client/network-failure` is the opposite in kind. It describes one attempt on
one machine — the server's — and baking it into the payload would replace a
fetch the browser can retry with a verdict it cannot. So framework and transport
failures are still left out, and that query mounts cold and fetches once.

The rule is the tag: every error _you_ declared on the procedure hydrates; the
built-in `client/*` and `server/*` failures do not.

Two details worth knowing if you inspect a payload. A retry detail about one
attempt (`fetchFailureReason`) is dropped rather than translated — it is
bookkeeping about a machine that is now gone. And the error crosses as its wire
form, the same shape the transport would have sent, because the serializer
rejects class instances by design; it is reconstructed on the way back in.

## Pass values through component props, not Results

The hydration boundary above is a result-rpc boundary: it owns a versioned codec
and knows how to reconstruct supported runtime values. An ordinary RSC prop or
Next server-action/RPC payload does not. Do not pass a `Result` or `TaggedError`
through one and expect its iterator, definition identity, or `Error` prototype to
survive.

Unwrap at the server/client component boundary:

```tsx
const result = await serverClient.users.get({ id });

if (result.status === "error") return <MissingUser id={id} />;
return <UserDetail initialUser={result.value} />;
```

When the browser needs the full Result API, let the result-rpc client make the
call or use `runtime.dehydrate()` for successful query data. The library promises
faithful runtime behavior across its own wire, not arbitrary serialization.

## Per-framework mounting

The pattern is identical everywhere; only the mount point and the prefetch site
move. Three worked examples ship in the repo:

| Example             | Framework                | Prefetch happens in    | RPC handler mounts at                |
| ------------------- | ------------------------ | ---------------------- | ------------------------------------ |
| `09-waku`           | Waku (RSC)               | async server component | `src/pages/_api/rpc.ts` → `/rpc`     |
| `10-nextjs`         | Next.js App Router (RSC) | async server component | `app/api/rpc/route.ts` → `/api/rpc`  |
| `11-tanstack-start` | TanStack Start (SSR)     | route **loader**       | `src/routes/api.rpc.ts` → `/api/rpc` |

Three traps worth knowing before you wire your own:

- **Match the endpoint on both ends.** The library defaults to `/rpc`, but
  Next.js and TanStack Start mount route handlers under `/api/`. Set both
  `endpoint` on `createFetchHandler` _and_ `url` on `fetchTransport`, or every
  call 404s silently.
- **TanStack Start reserves `src/server.ts` and `src/client.ts`.** It resolves
  those paths as its own optional entries, so the file names used by every other
  result-rpc example silently hijack them (the symptom is an opaque
  `Cannot read properties of undefined (reading 'fetch')`). Name them
  `rpc-server.ts` / `rpc-client.ts` there.
- **In TanStack Start, loaders are isomorphic — that is a client-boundary
  hazard.** A loader that imports your database module directly typechecks and
  works in dev SSR, then ships your database to the browser on the first client
  navigation. There is no `'use client'` directive to protect you here: put the
  server wall at a `createServerFn`, and re-read
  [The client boundary](/concepts/client-boundary/).

All three exercise the same app end to end — prefetched paginated feeds,
skeleton fallbacks, mutations patching server-rendered rows, and a
`tryDb` constraint surfacing as a domain error — so you can diff them to see
exactly what the framework changes and what it doesn't.

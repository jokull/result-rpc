# 11-tanstack-start — result-rpc kitchen sink on TanStack Start SSR

A real, runnable TanStack Start app (`@tanstack/react-start@1.168.32`,
`@tanstack/react-router@1.170.18`, Vite 7, React 19) exercising the same
surface as [09-waku](../09-waku) — cursor-paginated feed, detail route,
entity-patching mutations, a `tryDb` constraint path, a one-off aggregate
kept fresh via `.affects()`, server prefetch + hydration with zero loading
flash, and a grep-proven client boundary.

The two examples are deliberately diffable: identical `contract.ts`,
`schema.ts`, `models.ts`, `errors.ts`, `db.ts`, `skeleton.tsx` and nearly
identical components. **Everything that differs is the integration**, and
that difference is the point of this example.

```bash
pnpm install --ignore-workspace   # own node_modules; builds better-sqlite3
pnpm dev                          # vite dev (http://localhost:3000)
pnpm build                        # dist/client + dist/server
pnpm check                        # tsc --noEmit
```

The app: 30 seeded Japan travel spots (better-sqlite3 + Drizzle 1.0),
likeable rows, an "add spot" form with a UNIQUE(name) constraint, stats
tiles, and `/spots/spot-NN` detail pages.

---

## The headline: SSR loaders, not RSC

Waku and Next App Router are **RSC**. The server boundary is a component:
an `async function Page()` runs only on the server, awaits its prefetches,
and streams a client reference across the RSC boundary. `'use client'` is
the wall, and the wall is what keeps your database out of the browser.

TanStack Start is **SSR + file-based routing**. There is no server
component. Three consequences shape the whole integration:

### 1. The prefetch point is a route `loader`, not a component

```tsx
// src/routes/index.tsx
export const Route = createFileRoute("/")({
  loader: () => prefetchHome(), // returns runtime.dehydrate()
  component: Home,
});

function Home() {
  const state = Route.useLoaderData();
  return (
    <ResultRpcHydrationBoundary state={state}>
      <StatsBar />
      <AddSpotForm />
      <Feed />
    </ResultRpcHydrationBoundary>
  );
}
```

This is the same three-step contract the [RSC
guide](../../website/src/content/docs/guides/rsc.md) describes — prefetch →
dehydrate → hydrate — with the loader standing in for the async server
component. `runtime.dehydrate()` is a plain `{ v, serializer, payload }`
object, so it serializes through Start's SSR payload like any other loader
data with no adapter.

### 2. Loaders are ISOMORPHIC, so the server boundary must be explicit

The trap: a route loader runs on the server for the document request **and
in the browser on every client-side navigation**. A loader that imported
`db.ts` directly would ship better-sqlite3, the Drizzle driver and every
handler closure to the browser. Under RSC the `'use client'` wall would
have stopped that; here nothing does.

So the boundary is `createServerFn` (`src/ssr.ts`):

```ts
export const prefetchHome = createServerFn({ method: "GET" }).handler(async () => {
  const { runtime, serverClient } = buildRuntime(); // parity server client
  await Promise.all([
    runtime.prefetchPaginated(serverClient.spots.feed, {}),
    runtime.prefetch(serverClient.stats.overview, {}),
  ]);
  return runtime.dehydrate();
});
```

Start's compiler replaces the handler body with a fetch stub in the client
build, so `rpc-server.ts` (and the canary inside it) never reaches the
browser graph — see the grep below. During SSR the function is invoked
in-process, with no HTTP hop.

The net behaviour is _better_ than it sounds: on a client-side navigation
the loader makes one server-function call that returns a **whole warm
cache**, instead of the destination's components each firing their own RPC
on mount. Same no-flash property as RSC prefetch, same one-round-trip cost.

### 3. There is no `'use client'` and no `cache()`

- **No directives.** Every component renders on the server and hydrates on
  the client. `src/components/feed.tsx` carries no `'use client'` — compare
  09-waku, where it must. `result-rpc/react` ships the directive itself;
  under Start's plain-SSR bundler it is simply inert.
- **No `cache()`.** RSC needs React's per-request memo so several server
  components can share one runtime and dehydrate once. Here one loader is
  one server call is one runtime is one dehydrate — nothing to memoize.
  Nested boundaries still merge if you prefetch in several routes of a
  match chain.

### Why the loader payload and not the router's `dehydrate`/`hydrate`?

TanStack Router exposes router-level `dehydrate`/`hydrate` options, which
would let one global runtime ride the SSR payload. Rejected, for two
reasons:

1. **Colocation.** Route-level prefetch is the idiom the rest of the
   TanStack ecosystem uses, and it keeps each route's data next to the
   route. Router-level hydration forces a single app-wide runtime built in
   `router.tsx`, which then has to be threaded into the provider — more
   moving parts, and the same isomorphism problem, just relocated.
2. **Client navigations.** Router `dehydrate` only fires for the document
   request. A route loader keeps working on client-side navigation, so
   `/spots/$id` is warm whether you land on it or navigate to it. Verified
   both ways below.

`ResultRpcHydrationBoundary` in the route component is therefore both the
simpler and the more idiomatic-for-Start choice.

---

## The rest of the recipe

### Mounting the RPC handler

Start's file-based routes carry an optional `server.handlers` record keyed
by HTTP method — that is the API-route mechanism in 1.168/1.170 (there is
no separate `createServerFileRoute` any more):

```ts
// src/routes/api.rpc.ts   →   /api/rpc
export const Route = createFileRoute("/api/rpc")({
  server: { handlers: { POST: ({ request }) => rpcHandler(request) } },
});
```

`createFetchHandler` is a plain `Request => Promise<Response>`, so the
adapter is one expression. Start's server routes live under `/api`, while
result-rpc defaults to `/rpc`, so **both ends are set explicitly**:
`endpoint: "/api/rpc"` on `createFetchHandler` (src/rpc-server.ts) and
`fetchTransport({ url: "/api/rpc" })` on the client (src/rpc-client.ts).

### Depending on the library

`"result-rpc": "file:../.."` — no Vite aliases. This resolves through the
real `exports` map, so the example validates the published subpaths
(`result-rpc`, `/client`, `/server`, `/react`, `/drizzle`, and the new
react-free `/query`) rather than a hand-written alias list. The only
concession it needs is `resolve.dedupe: ["react", "react-dom"]` in
`vite.config.ts`, because the linked package sits outside the example root
and could otherwise pull a second React. Run `pnpm build` at the repo root
first — `file:` links point at `dist/`.

### Client-boundary proof

`src/contract.ts` imports only `result-rpc`, the wire codecs, the models,
and `import type { AppContext }`. The browser client is built from the
contract, never the router. A canary lives inside the like handler in
`src/rpc-server.ts`, compared against **runtime input** so the minifier
cannot constant-fold it:

```ts
const SERVER_SECRET = "TSS_SECRET_marker_do_not_ship";
// ...
if (input.id === SERVER_SECRET) return err(errors.notFound({ spotId: SERVER_SECRET }));
```

After `pnpm build`:

| grep target                                                                                  | result                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `grep -rl TSS_SECRET_marker_do_not_ship dist/client/`                                        | **no matches** ✅                                       |
| `grep -rl TSS_SECRET_marker_do_not_ship dist/server/`                                        | `dist/server/assets/rpc-server-*.js` (where it belongs) |
| `grep -rlE "better-sqlite3\|node:fs\|spots.sqlite\|drizzle-orm/better-sqlite3" dist/client/` | **no matches** ✅                                       |

Both boundaries hold: the `/api/rpc` server route and the `createServerFn`
prefetchers are the only importers of `rpc-server.ts`, and Start strips
both from the client build.

### Browser verification

Against `pnpm dev` on port 4311, via `agent-browser`:

| check                         | result                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| cold load of `/`              | 8 rows + stats in the SSR HTML, `.skeleton-card` count 0, and `performance.getEntriesByType('resource')` shows **0** `/api/rpc` requests |
| "Load more"                   | rows 8 → 16, meta `16 spots loaded · 2 pages`, exactly **1** `/api/rpc` call                                                             |
| like row 1                    | `♥ 0 → ♥ 1` patched in place, row count stays 16 (no list refetch); the `.affects()` aggregate goes `331 → 332`                          |
| navigate to `/spots/spot-01`  | detail renders `♥ 1` — the entity patch crossed the query boundary — with **no extra** `/api/rpc` call                                   |
| hard load of `/spots/spot-01` | SSR'd detail, **0** `/api/rpc` calls                                                                                                     |
| duplicate name                | `spot/name-taken` → `"Fushimi Inari at dawn" already exists` (from `db/unique-violation` via `tryDb`)                                    |
| fresh name                    | inserts; `.affects(feedContract)` resets the window to page one and the aggregate goes 30 → 31 spots                                     |

Screenshots in `./screenshots/`: `01-home-ssr-prefetched.png`,
`02-load-more.png`, `03-like-patched.png`, `04-detail-route.png`,
`05-add-spot-unique-violation.png`, `06-add-spot-inserted.png`.

---

## FRICTION log

1. **`src/server.ts` and `src/client.ts` are RESERVED filenames.** Start
   resolves its optional client/server entries by looking for `./client`
   and `./server` in `srcDirectory` — so the natural result-rpc layout
   (`src/server.ts` = router + handlers, `src/client.ts` = browser client,
   used verbatim in every other example) silently hijacked both entries.
   The failure mode is opaque: `TypeError: Cannot read properties of
undefined (reading 'fetch')` from inside the dev-server plugin, because
   `src/server.ts` has no default export with a `fetch`. Renamed to
   `rpc-server.ts` / `rpc-client.ts`. Also reserved: `src/start.ts`, and
   `src/router.tsx` is _required_ (must export `getRouter`).

2. **The entry plan is cached across restarts.** After the rename the dev
   server still resolved `virtual:tanstack-start-server-entry` to the
   deleted `src/server.ts`. `rm -rf .tanstack node_modules/.vite` fixed it.

3. **Isomorphic loaders are a live client-boundary hazard.** This is the
   one thing an RSC-trained reflex gets wrong. `loader: async () => { const
{ db } = await import("../db"); ... }` typechecks, works in dev SSR, and
   ships your database to the browser on the first client-side navigation.
   `createServerFn` is not optional decoration here — it is the wall.

4. **No `start` script.** `vite build` emits `dist/client` +
   `dist/server/server.js` (a bare `{ fetch }` entry); a runnable server
   needs a hosting preset (nitro/netlify/vercel/node). The production build
   is used here only for the client-boundary grep, so the script was
   dropped rather than faked.

5. **`@types/node` is required by `vite/client` types.** `tsc` fails with
   `TS2688: Cannot find type definition file for 'node'` until it is
   installed — easy to miss in an example that has no Node-API code of its
   own.

6. **The Drizzle source is type-only** (same as 09-waku): the model's
   `$satisfies<typeof spots.$inferSelect>()` proof is erased and result-rpc's
   declarations no longer depend on Drizzle's nominal table classes.

7. **`better-sqlite3` external** via `ssr.external` in `vite.config.ts`,
   plus `pnpm.onlyBuiltDependencies` so pnpm 10 runs its native
   postinstall. No SSG step here, so unlike Waku one declaration sufficed.

Everything else was uneventful: `createFileRoute`, `server.handlers`,
`createServerFn`, `Route.useLoaderData()`, `Route.useParams()`, the
generated `routeTree.gen.ts`, and `shellComponent` on the root route all
behaved as documented. The library needed no workarounds — `result-rpc/query`
in the server function, `result-rpc/react` in components, straight off the
published `exports` map.

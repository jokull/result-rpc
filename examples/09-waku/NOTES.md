# 09-waku — result-rpc kitchen sink on Waku 1.0 RSC

A real, runnable Waku app (`waku@1.0.0-beta.8`, fs-router, React 19) that
exercises the whole result-rpc surface end to end: cursor-paginated feed,
detail segment route, entity-patching mutations, a `tryDb` constraint path,
a one-off aggregate kept fresh via `.affects()`, RSC prefetch + hydration
with zero loading flash, and a grep-proven client boundary.

```bash
pnpm install --ignore-workspace   # own node_modules; builds better-sqlite3
pnpm dev                          # waku dev (http://localhost:3000)
pnpm build && pnpm start          # production build works too
```

The app: a feed of 30 seeded Japan travel spots (better-sqlite3 +
Drizzle 1.0), likeable rows, an "add spot" form with a UNIQUE(name)
constraint, stats tiles, and `/spot-NN` detail pages.

## The integration recipe

### 1. Mounting the RPC handler

Waku serves `src/pages/_api/rpc.ts` at `/rpc` — which is exactly
result-rpc's default `endpoint`, so the two conventions line up with zero
glue:

```ts
// src/pages/_api/rpc.ts
import { rpcHandler } from "../../server.js"; // createFetchHandler({ router, createContext })
export const POST = rpcHandler;
export const getConfig = async () => ({ render: "dynamic" }) as const;
```

`createFetchHandler` is a plain `Request => Promise<Response>` function and
Waku API endpoints are plain `Request => Response` exports. Nothing to adapt.

### 2. RSC prefetch + hydration (the no-flash pipeline)

- `src/rsc.ts` (server-only) builds ONE runtime per request:
  `cache(() => createQueryRuntime({ client: createServerClient(router, { context }) }))`.
  Parity mode runs the real middleware/codec/envelope path in-process.
- `src/pages/index.tsx` (`render: 'dynamic'`, async server component)
  awaits `runtime.prefetchPaginated(serverClient.spots.feed, {})` and
  `runtime.prefetch(serverClient.stats.overview, {})`, then renders
  `<ResultRpcHydrationBoundary state={runtime.dehydrate()}>` around the
  client components.
- `src/components/feed.tsx` (`'use client'`) observes
  `useResultPaginatedQuery(client.feed, {}, { staleTime: 60_000 })` — the
  hydrated cache makes the state `"success"` on first paint.

Browser-verified: on a cold page load the feed renders 8 rows immediately
and `performance.getEntriesByType("resource")` shows **zero** `/rpc`
requests — the staleTime window trusts the server payload, so the first
mount costs nothing. "Load more" then issues exactly one `/rpc` call and
appends page two into the same cache entry.

### 3. The client boundary, proven

`src/contract.ts` imports only `result-rpc`, the wire codecs, the models,
and `import type { AppContext }`. Client components import the contract
(via `src/client.ts`) and never the router. A canary
`SERVER_SECRET = "WAKU_SECRET_marker_do_not_ship"` lives inside the like
handler in `src/server.ts`, referenced against runtime input so the
minifier cannot fold it away.

After `waku build`:

- `grep -rl WAKU_SECRET_marker_do_not_ship dist/public/` → **no matches**
  (the entire client output).
- `grep -rl ... dist/server/` → `dist/server/assets/server-*.js` (present
  where it belongs).
- Client assets also contain no `better-sqlite3` / `node:fs` / db-path
  traces. (One `drizzle` string does ship: `modelFromDrizzle` reads table
  metadata from `drizzle-orm/sqlite-core` builders, which are browser-safe
  by design — the driver is not in the graph.)

### 4. Kitchen-sink behaviors exercised in the browser

- **Pagination**: 8-row pages over 30+ rows; `fetchNext` appends; the meta
  line tracks `rows / pageCount` from one cache entry.
- **Entity patching**: liking row one flips `♥ 0 → ♥ 1` in place (no list
  refetch — row count stays put), and navigating to `/spot-01` shows the
  patched count because the detail view reads the same entity.
- **`.affects()` on a one-off**: the same like bumps the "total likes"
  stats tile (331 → 332) — the aggregate has no identity, so it rides
  declared invalidation instead of entity patching.
- **`tryDb` + UNIQUE**: submitting a duplicate name surfaces
  `spot/name-taken` ("… already exists") from `db/unique-violation`;
  a fresh name inserts, and the map-less `.affects(feedContract)`
  invalidates the whole list (the honest blast radius for an insert — the
  loaded window resets to page one and the new row appears on the last
  page).
- **Skeletons**: shimmer placeholders render whenever a query is genuinely
  `"pending"`. In this app Waku prefetches every navigation server-side,
  so they are essentially never seen — which is the point.

Screenshots in `./screenshots/`: `01-home-prefetched.png`,
`02-load-more.png`, `03-like-patched.png`, `04-detail.png`,
`05-add-spot.png`.

## FRICTION log

Things that fought back, in the order they bit:

1. **LIBRARY BUG (fixed in `src/server/contract.ts`, reported):**
   `ProcedureImplementer.handler()` returned
   `Procedure<..., "query" | "mutation">`, discarding the contract's exact
   kind. Consequence: every procedure on `createServerClient(router)` typed
   as a query/mutation **union**, so the documented RSC pattern
   `runtime.prefetch(serverClient.spots.byId, …)` failed to typecheck
   (`'"mutation"' is not assignable to '"query"'`). Contract-derived
   clients (what every prior example uses) were unaffected, which is why it
   went unnoticed. Fix: return
   `Procedure<..., Exclude<TKind, "subscription">>` (one signature line +
   a cast). `pnpm check`, type tests, all 242 bun tests, and build pass.

2. **`result-rpc/react` cannot load in the react-server environment.** It
   calls `React.createContext` at module scope, and under Waku's RSC
   condition `react` does not export it. Building this example surfaced the
   problem and **both halves were fixed upstream** — this example now uses
   the shipped API with no workarounds:
   - `createQueryRuntime` is published as its own react-free entry,
     **`result-rpc/query`**, for exactly this use. Server modules
     (`src/rsc.ts`) import it from there; `result-rpc/react` stays for
     client components.
   - `result-rpc/react` now ships a **`'use client'`** directive, so a
     server component can import `ResultRpcHydrationBoundary` directly and
     the bundler turns it into a client reference. The local
     re-export wrapper this example used at first is gone.

3. **Alias order + one React.** `@rollup/plugin-alias` string finds match
   prefixes, so `result-rpc` must come LAST or it swallows
   `result-rpc/react`. And because the aliased dist files live outside the
   example root, Vite must be told `resolve.dedupe: ["react", "react-dom"]`
   (two React copies = silent hook breakage) plus `server.fs.allow` up to
   the repo root.

4. **Two drizzle-orm copies at typecheck time.** `dist/drizzle.d.ts`
   resolves `drizzle-orm` from the repo root while the example resolves its
   own — nominally identical rc.4s that TS rejects (protected member
   `resolveTypes`). Fixed with tsconfig `paths` pinning `drizzle-orm` (and
   `drizzle-orm/*`) to the example's copy for the whole program.

5. **better-sqlite3 must stay external in EVERY server environment.**
   `ssr.external` covers dev, but `waku build`'s SSG step bundled the
   driver into the RSC server bundle, inlining `bindings` → `__filename is
not defined in ES module scope`. Fixed with
   `environments: { rsc: { resolve: { external: ["better-sqlite3"] } }, ssr: { … } }`
   in `waku.config.ts`. Also: pnpm 10 blocks native postinstalls by
   default — `pnpm.onlyBuiltDependencies: ["better-sqlite3"]` in
   package.json.

6. **The minifier ate the first canary.** A dead
   `if (SECRET.length === 0)` reference was constant-folded, so the marker
   vanished from the SERVER bundle too and the grep proved nothing.
   Comparing the canary against runtime input keeps it alive where it
   belongs.

7. **Root `tsconfig.json` glob.** The repo's `pnpm check` includes
   `examples/**`; this example imports the package by name (not
   `../../src`), so it is excluded there and typechecked by its own
   `tsconfig.json` instead.

Waku itself was the least of it: fs-router, `getConfig`, `_api`, static
layout over dynamic pages, and `PageProps<"/[id]">` all behaved exactly as
documented, in dev and in `waku build && waku start`.

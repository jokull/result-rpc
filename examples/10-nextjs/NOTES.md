# 10-nextjs — result-rpc kitchen sink on the Next.js 16 App Router

The same app as [`09-waku`](../09-waku), on a different framework — diff the
two `src/` trees and the only differences are the framework glue. A real,
runnable Next.js app (`next@16.2.12`, App Router, Turbopack, React 19) that
exercises the whole result-rpc surface end to end: cursor-paginated feed,
dynamic detail segment, entity-patching mutations, a `tryDb` constraint path, a
one-off aggregate kept fresh via `.affects()`, RSC prefetch + hydration with
zero loading flash, and a grep-proven client boundary.

```bash
pnpm install --ignore-workspace   # own node_modules; builds better-sqlite3
pnpm dev                          # http://localhost:3000
pnpm build && pnpm start          # production build works too
```

The app: a feed of 30 seeded Japan travel spots (better-sqlite3 + Drizzle 1.0),
likeable rows, an "add spot" form with a UNIQUE(name) constraint, stats tiles,
and `/spots/spot-NN` detail pages.

## What is shared with 09-waku, verbatim

`src/schema.ts`, `src/errors.ts`, `src/models.ts`, `src/db.ts`,
`src/contract.ts`, `src/server.ts`, `src/client.ts`,
`src/components/skeleton.tsx`, `app/globals.css`. Framework-specific bits are
only: the `app/` tree, `src/rsc.ts`'s import path, `next/link` instead of
`waku`'s `Link`, and the endpoint strings.

## The integration recipe

### 1. Depending on the workspace build

`"result-rpc": "file:../.."` in `package.json`. pnpm packs the package the way
`npm publish` would (honouring `files`) into its store and links the peer deps
from THIS example, so:

- every subpath import goes through the real `exports` map — this example is a
  live test that `./query`, `./react`, `./server`, `./client`, `./drizzle` are
  all correctly published;
- exactly ONE React resolves (pnpm links `react@19.2.4` from the example into
  the packed copy — verified: `dist/react/index.js` does not reach the repo
  root's `node_modules/react`).

The one catch: the packed copy is a **snapshot taken at install time**. After
`pnpm build` at the repo root, re-run `pnpm install --ignore-workspace` here
(or `pnpm rebuild`/`pnpm install --force`) or you are testing stale `dist`.

No `transpilePackages`, no webpack/turbopack aliases for the library. `dist` is
plain ESM and `dist/react/index.js` already carries `"use client"`, which is
all Next needs.

### 2. Mounting the RPC handler — and the endpoint mismatch

`createFetchHandler` returns a plain `(Request) => Promise<Response>`, which is
literally the App Router route-handler signature:

```ts
// app/api/rpc/route.ts
import { rpcHandler } from "../../../src/server";
export const POST = rpcHandler;
export const dynamic = "force-dynamic";
```

**GOTCHA.** The handler matches the request _pathname_ against its `endpoint`
option, and that option defaults to `"/rpc"`. Next's convention puts route
handlers under `app/api/**`, i.e. `/api/rpc`. So both ends must be told:

```ts
// src/server.ts
createFetchHandler({ router, createContext, endpoint: "/api/rpc", ... })
// src/client.ts
fetchTransport({ url: "/api/rpc" })
```

Leave either at the default and every call fails. (09-waku needs neither line —
Waku's `_api/rpc.ts` lands on `/rpc` exactly.)

### 3. Per-request runtime with `cache()`

```ts
// src/rsc.ts
export const getServerRuntime = cache(() => {
  const serverClient = createServerClient(router, { mode: "parity", context: createContext() });
  return { runtime: createQueryRuntime({ client: serverClient }), serverClient };
});
```

React's `cache()` memoizes per request, so the layout, the page, and any nested
server component share one runtime; prefetches accumulate and each boundary
dehydrates what has landed.

### 4. The two-entry rule (`result-rpc/query` vs `result-rpc/react`)

This is the part that is easy to get wrong, and Next enforces it loudly:

- **`result-rpc/query`** is react-free and has no directive. Server-only
  modules (`src/rsc.ts`) import `createQueryRuntime` from here, because that
  function must actually _execute_ in the react-server environment — and a
  react-server environment refuses to evaluate a `"use client"` module.
- **`result-rpc/react`** ships `"use client"`. Client components import the
  hooks and `ResultRpcProvider` from it. A **server component may import
  `ResultRpcHydrationBoundary` from it** — `app/page.tsx` and
  `app/spots/[id]/page.tsx` both do. The bundler turns it into a client
  reference instead of executing it. That is the boundary working as designed,
  not a leak.

Rule of thumb: _call_ nothing from `result-rpc/react` on the server; _rendering_
its components from the server is fine.

### 5. Prefetch + hydrate

```tsx
// app/page.tsx (async server component)
const { runtime, serverClient } = getServerRuntime();
await Promise.all([
  runtime.prefetchPaginated(serverClient.spots.feed, {}),
  runtime.prefetch(serverClient.stats.overview, {}),
]);
return (
  <ResultRpcHydrationBoundary state={runtime.dehydrate()}>
    <StatsBar />
    <AddSpotForm />
    <Feed />
  </ResultRpcHydrationBoundary>
);
```

`dehydrate()` returns `{ v, serializer, payload }` — a plain object with a
string payload, so it crosses the RSC boundary as an ordinary prop with no
special serializer. `app/layout.tsx` (server) renders the `'use client'`
`Providers` holding the one `ResultRpcProvider`; every boundary merges into it.

Client components set `staleTime: 60_000`, so the hydrated data is trusted and
the first mount makes **zero** requests.

Two Next-flavoured details:

- `export const dynamic = "force-dynamic"` on both pages and the route handler
  — they read sqlite per request.
- `loading.tsx` at both segments renders the shimmer skeletons while the
  server component's prefetch is in flight. The _client_ skeletons in
  `feed.tsx`/`spot-detail.tsx` are then essentially dead code on a prefetched
  paint — which is the point.
- `dehydrate()` only carries **successful** queries. `/spots/does-not-exist`
  therefore renders the skeleton and the client fetches once to surface
  `spot/not-found`; failures are deliberately not cached across the boundary.

## Browser verification (agent-browser, Chrome, 1200×950)

Against `next dev` on a freshly seeded database:

| Check                                                  | Result                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Cold load `/` — client `/api/rpc` calls on first paint | **0** (`performance.getEntriesByType("resource")`), 8 rows rendered, stats tiles filled                                         |
| "Load more"                                            | rows 8 → 16, meta `16 spots loaded · 2 pages`, **exactly 1** new `/api/rpc` call                                                |
| Like row 1                                             | `♥ 0 → ♥ 1` patched in place; row count stays 16 (no list refetch); "total likes" tile `331 → 332` via `.affects()`             |
| Client-side nav to `/spots/spot-01`                    | detail renders `♥ 1` with **0** further calls — the entity patch crossed the query boundary before the detail view ever fetched |
| Cold load `/spots/spot-05`                             | renders server-prefetched, **0** client calls                                                                                   |
| `tryDb` + UNIQUE                                       | duplicate name → `spot/name-taken` → `"Fushimi Inari at dawn" already exists`                                                   |
| Insert a fresh name                                    | succeeds; `.affects(feedContract)` invalidates the whole list (window resets to page one) and the spots tile goes `30 → 31`     |

Screenshots in `./screenshots/`: `01-home-prefetched.png`, `02-load-more.png`,
`03-like-patched.png`, `04-detail.png`, `05-add-spot-conflict.png`,
`06-add-spot-inserted.png`.

## Client-boundary proof

`src/server.ts` plants a canary inside the like handler, compared against
_runtime input_ so the minifier cannot constant-fold it away:

```ts
const SERVER_SECRET = "NEXT_SECRET_marker_do_not_ship";
// …inside the handler:
if (input.id === SERVER_SECRET) return err(errors.notFound({ spotId: SERVER_SECRET }));
```

After `next build`:

```
grep -rl NEXT_SECRET_marker_do_not_ship .next/static/   → no matches
grep -rl NEXT_SECRET_marker_do_not_ship .next/server/   → .next/server/chunks/[root-of-the-server]__*.js
                                                          .next/server/chunks/ssr/_*.js
```

Absent from the entire client output, present where it belongs — so the
reference genuinely survives minification and the grep proves something.

Additional greps over `.next/static/`, all **0 files**: `better-sqlite3`,
`node:fs`, `spots.sqlite`, `INSERT INTO spots`, `tryDb`, `createFetchHandler`.

One client chunk does mention `drizzle`: `modelFromDrizzle` reads table metadata
from the `drizzle-orm/sqlite-core` _builders_, which are browser-safe by design.
The driver is not in the graph.

## FRICTION log

1. **LIBRARY-ADJACENT, WORKED AROUND — Turbopack empties the `drizzle-orm`
   barrel.** `drizzle-orm@1.0.0-rc.4`'s root entry is a pure re-export barrel
   with `"sideEffects": false`. In _every_ Next 16 server graph (route handler,
   RSC, SSR) Turbopack tree-shakes it to nothing: `import { asc, count, eq, sql }
from "drizzle-orm"` gives `undefined` for every name, and `import * as DZ`
   gives `undefined` for the namespace itself. Deep subpaths
   (`drizzle-orm/sqlite-core`, `drizzle-orm/sql/expressions/select`) are fine,
   and `next dev --webpack` is fine, so it is a Turbopack barrel-analysis bug,
   not drizzle's and not result-rpc's. Setting `experimental.optimizePackageImports:
[]` does **not** help. Fix:
   `turbopack.resolveAlias: { "drizzle-orm": "drizzle-orm/index.js" }`.
   Cost of not knowing: the failure surfaces only as
   `server/internal` + `TypeError: (void 0) is not a function` from inside a
   handler, i.e. an empty dehydrated payload and a page full of skeletons.
   `onInternalError` on `createServerClient` was what made it findable — worth
   wiring in any RSC integration while bringing it up.

2. **Turbopack rejects `new URL("../x.sqlite", import.meta.url)`.** It reads
   that as a static asset reference and fails the build with
   `Module not found: Can't resolve '../spots.sqlite'` — before the file
   exists. `src/db.ts` uses `join(process.cwd(), "spots.sqlite")` instead
   (09-waku's `fileURLToPath(new URL(...))` works fine under Vite).

3. **Endpoint mismatch.** See §2 above. Nothing warns you; the client just gets
   a 404 body it cannot decode. Worth a line in the RSC guide.

4. **`file:` dependency staleness.** `file:../..` is a _packed snapshot_, not a
   live symlink. Rebuilding the library at the repo root does not update the
   example until you reinstall. Good for realism (you get the published
   `exports` map, which is a stronger test than aliases), mildly annoying in a
   tight edit loop.

5. **`import type { AppContext } from "./server"` in the contract.** Fine —
   SWC erases it — but note `src/server.ts` also does `import "server-only"`.
   The type-only edge does not drag that in, and the canary grep confirms it.

6. **`.js` import specifiers.** Copied from 09-waku (NodeNext style) they were
   stripped to extensionless, which is what a Next/`bundler`-resolution project
   expects. Both work under Turbopack; extensionless matches the ecosystem.

Everything else — route handlers, `cache()`, `loading.tsx`, `params` as a
Promise, `dynamic = "force-dynamic"`, the `"use client"` directive on
`result-rpc/react` — behaved exactly as documented, in dev and in
`next build && next start`.

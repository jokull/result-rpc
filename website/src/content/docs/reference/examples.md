---
title: "Examples"
description: "The escalation ladder: eight runnable rungs that double as the DX regression suite — each one proves its claims with request counters, not screenshots."
---

The `examples/` directory is an escalation ladder. Every rung is a
self-contained app with runtime tests, every file typechecks under the
repo's strict `pnpm check`, and the main claims are asserted with
**per-procedure request counters** — the examples are the library's DX
regression suite, not demos.

For a persistent browser application, open the [live ticket
demo](https://demo.result-rpc.com) or read its [implementation
notes](/reference/ticket-demo/). It runs on Cloudflare Workers and D1 and makes
optimistic updates, entity patches, cursor pagination, and declared
invalidation visible in a client-event panel.

```bash
bun test examples/01-hello             # any single rung
bun test examples                      # the whole ladder
bun run examples/07-tracker/serve.ts   # 07 also runs in a real browser
```

## Which rung do you want?

| Rung                                     | Start here if you want…                | Headline proof                                                      |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| [01-hello](#01-hello)                    | the smallest browser-safe app          | one returned error, one unified failure channel                     |
| [02-todo](#02-todo)                      | mutations + optimistic basics          | rollback on failure, catalog over a narrowed union                  |
| [03-docs](#03-docs)                      | the whole system, minimally            | avatar patch: 1 request, 0 refetches                                |
| [04-router](#04-router)                  | TanStack Router integration            | routes are shells; loaders prefetch layers                          |
| [05-router-glue](#05-router-glue)        | proof you need no router package       | the same app on ~60 lines of app-owned glue                         |
| [06-sentry](#06-sentry)                  | the observability story                | incident-id correlation with zero plumbing                          |
| [07-tracker](#07-tracker)                | a real app, end to end                 | built _blind_ from the docs; its friction log drove library fixes   |
| [08-bookings](#08-bookings)              | entities on a real database            | Drizzle 1.0; one rename patches 4 surfaces across 2 paginated feeds |
| [09-waku](#framework-examples)           | server rendering on Waku (RSC)         | first paint from the server at **zero** client requests             |
| [10-nextjs](#framework-examples)         | server rendering on Next.js App Router | same app, same proof, `app/api/rpc/route.ts`                        |
| [11-tanstack-start](#framework-examples) | server rendering without RSC           | prefetch in a **loader**; the isomorphic-loader hazard, named       |

## 01-hello

One procedure, one domain error, no shells — the
[quickstart](/start/quickstart/), split into contract, server, client, and UI
modules. The handler _returns_ its failure (`err(...)`) against a declared
union, the browser imports the contract rather than the router, and the
component switches over one channel that includes the transport. Read this
first if you're arriving from tRPC.

## 02-todo

Mutations with optimistic updates and rollback, the basic
`boundaryShells()` onion, the three-state connection banner, and an
`errorCatalog` over a shell-narrowed union. The list's failure branch is
`todos.error satisfies never` — the compiler certifying the shells are
mounted.

## 03-docs

The whole system in one small app: a `defineService` dependency graph,
optional→required session/viewer layers, a four-shell onion, entity
models, a rendered subscription, and a defect escalation boundary. The
key test: change the avatar, and the header — a _different query_ —
shows the new image at exactly one request (the mutation itself), zero
refetches. Compile-time probes pin the narrowed unions: a query resolving
a dozen possible failures presents exactly `doc/not-found`.

## 04-router

TanStack Router integration by hand — **routes are shells**. Pathless
layout routes mount the session and viewer layers, a route claims its
feature error, `errorComponent` receives escalated defects, a pausing shell's
`onError` navigates, and layout loaders prefetch each layer's context procedure so
the first committed paint renders session, viewer, and content with no
fallback states.

## 05-router-glue

Rung 04 rebuilt on app-owned glue (`router-glue.tsx`, ~60 lines):
`routeShell` fragments spread into `createRoute`, so one declaration per
layer produces both the provider component and the prefetch loader — proof
the router integration needs no package, which is why routing stays a
deliberate non-goal.

## 06-sentry

The observability pillar end to end: a Sentry-shaped stub receives wire
breadcrumbs, the paused `claimed` trail with its owning shell, severity-routed
server captures, and a defect whose captured server exception carries the
same incident id the client received — correlation across the wire with no
request-id plumbing.

## 07-tracker

A team issue tracker exercising the whole surface as one app — and the
rung with a story: it was built **blind** by an engineer persona working
from the docs alone, adversarially reviewed, then fixed. Its `FRICTION.md`
is the honest log, and it drove three same-day library fixes (inline hook
options, codec-rejected input handling, proxy introspection).

What it exercises: session layer, entity patching with a `touch` cascade,
declared invalidation, optimistic create with client-minted ids (the form
validates the human with `validateStandard` before the wire is involved),
the offline arc — mounted offline → **zero** wire calls → exactly one on
reconnect — `gen`/`Result.tryPromise` composition collapsed at the procedure
boundary, a subscription feed, and the stale-deploy form flow: a
deliberately old-shaped client whose bad request crosses the wire and
comes back as field-projected `server/bad-request` at exactly one call.
`serve.ts` serves it for a real browser.

## 08-bookings

The ground-truth proof on a **real database** — Drizzle ORM 1.0 over
bun:sqlite, real SQL, relations v2, shaped after a census of a
280-procedure production tRPC API. Built to answer "is what entities buy
worth what they cost" with numbers:

- **Cost**: four explicit wire models checked against Drizzle row types with
  [`$satisfies<Source>()`](/concepts/model-sources/) — schema drift is a type error,
  while no database metadata enters the browser graph.
- **Buy**: `users.rename` patches **four surfaces** — review rows on
  cached pages of two different paginated feeds, a top-reviewer card, and
  the booked-by line inside a four-level relational tree — at exactly one
  request.
- The locale trap closed by a composite `["id","locale"]` key; `min()`
  aggregates that stay query-relative while the entity inside them
  patches; derived summaries refreshed by `.affects`; and `tryDb` turning
  a UNIQUE constraint into a domain error — the insert _is_ the
  uniqueness check, no pre-check SELECT anywhere.

Its `NOTES.md` is the model-vs-pick-vs-one-off decision table applied to
every output shape, plus the cost ledger against disciplined tRPC + React
Query and the Drizzle 1.0 migration notes (relations v2, `jsonb_*` under
Bun).

## Framework examples

Rungs 09–11 are the **same app on three frameworks** — a feed of travel spots
on Drizzle 1.0 + SQLite, with cursor pagination, an entity-returning mutation, a
one-off aggregate kept fresh by `.affects()`, a `tryDb` constraint surfacing as
a domain error, and shimmer skeletons. Their contract, models, schema, and
components are byte-identical across all three, so a diff shows you exactly what
each framework changes and what it doesn't. See the [RSC
guide](/guides/rsc/) for the shared pattern.

Each is browser-verified with the same four proofs: rows render server-prefetched
at **zero** client requests on first paint, "Load more" costs exactly one call, a
like patches its row **in place** while the aggregate follows, and a planted
server-only canary is **absent** from the built client bundle.

|             | `09-waku`               | `10-nextjs`             | `11-tanstack-start`     |
| ----------- | ----------------------- | ----------------------- | ----------------------- |
| Model       | RSC                     | RSC                     | SSR + router loaders    |
| Prefetch in | async server component  | async server component  | route `loader`          |
| Handler     | `src/pages/_api/rpc.ts` | `app/api/rpc/route.ts`  | `src/routes/api.rpc.ts` |
| Server wall | `'use client'` boundary | `'use client'` boundary | `createServerFn`        |

The TanStack Start rung is the instructive one: without RSC there is no
`'use client'` directive to protect you, and its **isomorphic loaders** will ship
your database to the browser on the first client navigation if you import it
directly. That hazard is documented in [The client
boundary](/concepts/client-boundary/#isomorphic-loaders-are-a-second-leak-vector).

## The method behind the ladder

Rungs 01–06 grew with the library. 07 and 08 were built by agents — one
blind (docs-only, logging every friction), one spec-driven against the
production-API census — precisely so the examples test the documentation
as hard as they test the code. When a rung fought the library, the library
changed; the friction logs stay in the repo as the record.

Rungs 09–11 continued that: building 09 surfaced two real library defects (a
procedure kind widened away from its contract, and a React entry that could not
load under the react-server condition), both fixed and regression-pinned before
10 and 11 were built. Those two then ran against the shipped API with **no
workarounds** — which is the point of building the same thing three times.

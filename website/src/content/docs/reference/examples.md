---
title: "Examples"
description: "The escalation ladder: eight runnable rungs that double as the DX regression suite — each one proves its claims with request counters, not screenshots."
---

The `examples/` directory is an escalation ladder. Every rung is a
self-contained app with runtime tests, every file typechecks under the
repo's strict `pnpm check`, and the flagship claims are asserted with
**per-procedure request counters** — the examples are the library's DX
regression suite, not demos.

```bash
bun test examples/01-hello             # any single rung
bun test examples                      # the whole ladder
bun run examples/07-tracker/serve.ts   # 07 also runs in a real browser
```

## Which rung do you want?

| Rung | Start here if you want… | Headline proof |
| --- | --- | --- |
| [01-hello](#01-hello) | the smallest possible app | one error, one exhaustive switch |
| [02-todo](#02-todo) | mutations + optimistic basics | rollback on failure, catalog over a narrowed union |
| [03-docs](#03-docs) | the whole system, minimally | avatar patch: 1 request, 0 refetches |
| [04-router](#04-router) | TanStack Router integration | routes are shells; loaders prefetch layers |
| [05-router-glue](#05-router-glue) | proof you need no router package | the same app on ~60 lines of app-owned glue |
| [06-sentry](#06-sentry) | the observability story | incident-id correlation with zero plumbing |
| [07-tracker](#07-tracker) | a real app, end to end | built *blind* from the docs; its friction log drove library fixes |
| [08-bookings](#08-bookings) | entities on a real database | Drizzle 1.0; one rename patches 4 surfaces across 2 paginated feeds |

## 01-hello

One procedure, one domain error, no shells — the
[quickstart](/start/quickstart/), verbatim. The handler *returns* its
failure (`err(...)`) against a declared union, and the component switches
over one channel that includes the transport. Read this first if you're
arriving from tRPC.

## 02-todo

Mutations with optimistic updates and rollback, the basic
`boundaryShells()` onion, the three-state connection banner, and an
`errorCatalog` over a shell-narrowed union. The list's failure branch is
`todos.error satisfies never` — the compiler certifying the onion is
mounted.

## 03-docs

The whole system in one small app: a `defineService` dependency graph,
optional→required session/viewer layers, a four-shell onion, entity
models, a rendered subscription, and a defect escalation boundary. The
flagship test: change the avatar, and the header — a *different query* —
shows the new image at exactly one request (the mutation itself), zero
refetches. Compile-time probes pin the narrowed unions: a query resolving
a dozen possible failures presents exactly `doc/not-found`.

## 04-router

TanStack Router integration by hand — **routes are shells**. Pathless
layout routes mount the session and viewer layers, a route claims its
feature error, `errorComponent` receives escalated defects, `onError`
navigates, and layout loaders prefetch each layer's context procedure so
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
breadcrumbs, the `claimed` trail with its owning shell, severity-routed
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
reconnect — `gen`/`tryPromise` composition collapsed at the procedure
boundary, a subscription feed, and the stale-deploy form flow: a
deliberately old-shaped client whose bad request crosses the wire and
comes back as field-projected `server/bad-request` at exactly one call.
`serve.ts` serves it for a real browser.

## 08-bookings

The ground-truth proof on a **real database** — Drizzle ORM 1.0 over
bun:sqlite, real SQL, relations v2, shaped after a census of a
280-procedure production tRPC API. Built to answer "is what entities buy
worth what they cost" with numbers:

- **Cost**: four models in 13 lines, derived from the schema via
  [`modelFromDrizzle`](/guides/drizzle/) — the entity contract is the
  migration you were already writing plus a column allowlist.
- **Buy**: `users.rename` patches **four surfaces** — review rows on
  cached pages of two different paginated feeds, a top-reviewer card, and
  the booked-by line inside a four-level relational tree — at exactly one
  request.
- The locale trap closed by a composite `["id","locale"]` key; `min()`
  aggregates that stay query-relative while the entity inside them
  patches; derived summaries refreshed by `.affects`; and `tryDb` turning
  a UNIQUE constraint into a domain error — the insert *is* the
  uniqueness check, no pre-check SELECT anywhere.

Its `NOTES.md` is the model-vs-pick-vs-one-off decision table applied to
every output shape, plus the cost ledger against disciplined tRPC + React
Query and the Drizzle 1.0 migration notes (relations v2, `jsonb_*` under
Bun).

## The method behind the ladder

Rungs 01–06 grew with the library. 07 and 08 were built by agents — one
blind (docs-only, logging every friction), one spec-driven against the
production-API census — precisely so the examples test the documentation
as hard as they test the code. When a rung fought the library, the library
changed; the friction logs stay in the repo as the record.

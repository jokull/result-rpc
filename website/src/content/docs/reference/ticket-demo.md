---
title: "Ticket demo"
description: "A live Cloudflare Worker and D1 app that makes optimistic updates, entity coherence, pagination, and invalidation visible."
---

The [live ticket demo](https://demo.result-rpc.com) is a small product rather
than an isolated API example. It runs on a Cloudflare Worker with D1 and exposes
the client cache's decisions alongside the interface.

[Open the live demo →](https://demo.result-rpc.com)

The source lives in [`demo/`](https://github.com/jokull/result-rpc/tree/main/demo)
in the result-rpc repository.

## What to try

| Action                                     | What it demonstrates                                                                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change a ticket's status or edit its title | The list row and open detail pane update optimistically before the deliberately delayed mutation settles. The returned entity then reconciles every cached projection by identity.      |
| Load another page                          | Cursor pagination appends into one stable query without replacing the rows already on screen.                                                                                           |
| Move a ticket across a filtered list       | The optimistic entity patch updates known data immediately; the mutation's declared `.affects()` edge then refreshes list membership and aggregate counts.                              |
| Watch the proof panel                      | Client events distinguish wire calls, entity patches, optimistic writes, and invalidation-driven refetches. The behavior is inspectable instead of implied by the UI.                   |
| Take the browser offline                   | The application shell owns `client/offline`, presents one connection-level reaction, and resumes held work when connectivity returns. Components below it do not grow offline branches. |

Each browser receives an anonymous workspace token in local storage. Tickets are
stored in D1, so refreshing the page or returning later preserves that
workspace. Resetting the demo creates the same seeded dataset again.

## What the source proves

The demo keeps its runtime contract in `shared/`, its D1 implementation in
`server/` and `db/`, and the browser client in `client/`. The browser imports the
contract, not the router. A production-build test scans the emitted client
assets and fails if either the SQL schema or a planted server-only canary enters
the browser graph.

The Worker integration test runs the built artifact under Cloudflare's
production test harness and exercises SSR, pagination, detail reads, and a
mutation through the real result-rpc wire.

## Run it locally

```bash
npm --prefix demo install
npm --prefix demo run dev
```

The Worker configuration is the source of truth. `wrangler types` generates the
binding and runtime declarations from `demo/wrangler.jsonc`; there is no
`@cloudflare/workers-types` dependency.

```bash
npm --prefix demo test
npm --prefix demo run deploy
```

`deploy` builds the vinext application and publishes the generated Worker,
static assets, D1 binding, and `demo.result-rpc.com` Custom Domain directly to
Cloudflare.

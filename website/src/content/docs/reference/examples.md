---
title: "Examples"
description: "The escalation ladder: six runnable rungs that double as the DX regression suite."
---

The `examples/` directory is an escalation ladder, each rung a runnable app
with its own tests:

1. **01-hello** — one query, one error, no shells: the minimal surface.
2. **02-todo** — mutations, optimistic updates, the basic onion, an error
   catalog over a shell-narrowed union.
3. **03-docs** — the whole system: a service graph, optional→required layers,
   a four-shell onion, entity models, a rendered subscription, and a defect
   boundary. Its probes assert the payoffs directly: a query resolving a
   dozen possible failures presents exactly `doc/not-found`, and the avatar
   mutation patches the header by identity — the test proves exactly one
   request (the mutation) with zero refetches.
4. **04-router** — TanStack Router integration by hand: routes are shells.
   Pathless layouts mount the session and viewer layers, a route claims its
   feature error, `errorComponent` receives escalated defects, `onError`
   navigates, and layout loaders prefetch each layer's context procedure so
   the first paint has no fallback states.
5. **05-router-glue** — rung 4 rebuilt on app-owned glue
   (`router-glue.tsx`, ~60 lines): `routeShell` fragments spread into
   `createRoute`, so one declaration per layer produces both the provider
   component and the prefetch loader — proof the integration needs no package.
6. **06-sentry** — the observability pillar end to end: a Sentry-shaped stub
   receives wire breadcrumbs, the `claimed` trail with its owning shell,
   severity-routed server captures, and a defect whose captured exception
   carries the same incident id the client received — correlation with no
   request-id plumbing.

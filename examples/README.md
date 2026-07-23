# Examples

An escalation ladder. Each rung is a self-contained app with runtime tests
(`bun test examples/<rung>`), and every file typechecks under the repo's strict
`pnpm check` — the examples are the library's DX regression suite.

| Rung | App | Exercises |
| --- | --- | --- |
| `01-hello` | greeting service | minimal path: one error, one query, provider + hook |
| `02-todo` | todo list | mutations, optimistic rollback, app/defect shells, `errorCatalog` |
| `03-trips` | trip planner | `defineService` graph, `defineLayer` + `require`, five-layer onion, feature shell, subscription, escalation boundary |
| `04-router` | trips + TanStack Router | routes-as-shells by hand: module-level shells via `procedure:` selectors, `onError` navigation, loaders prefetching the layer cascade |
| `05-router-glue` | trips on app-owned glue | `router-glue.tsx` (~60 lines): `routeShell` fragments, auto-derived layer loaders — proof no router package is needed |
| `06-sentry` | billing form + Sentry stub | all four observability taps into one sink: wire breadcrumbs, claim trail with owner, severity-routed server capture, incident-id correlation across the wire |

Rung 4 reuses rung 3's server and proves the router mapping: pathless layout
routes mount the session and viewer shells, the trip route claims
`trip/not-found`, `errorComponent` is the escalate target, and each layout's
loader prefetches its layer's context procedure — the first committed paint
renders session, viewer, and trip with no fallback states.

Rung 3's test file ends with compile-time probes: the rename mutation — which
declares `Unauthorized | TripNotFound | TripLocked` plus six transport tags —
has a component-visible failure union of exactly `"trip/locked"`, and the trip
query's is `never`.

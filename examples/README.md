# Examples

An escalation ladder. Each rung is a self-contained app with runtime tests
(`bun test examples/<rung>`), and every file typechecks under the repo's strict
`pnpm check` — the examples are the library's DX regression suite.

| Rung | App | Exercises |
| --- | --- | --- |
| `01-hello` | greeting service | minimal path: one error, one query, provider + hook |
| `02-todo` | todo list | mutations, optimistic rollback, app/defect shells, `errorCatalog` |
| `03-docs` | shared-docs workspace | `defineService` graph, `defineLayer` + `require`, four-shell onion, rendered subscription, escalation boundary, compile-time union probes |
| `04-router` | docs + TanStack Router | routes-as-shells by hand: module-level shells via `procedure:` selectors, `onError` navigation, loaders prefetching the layer cascade |
| `05-router-glue` | docs on app-owned glue | `router-glue.tsx` (~60 lines): `routeShell` fragments, auto-derived layer loaders — proof no router package is needed |
| `06-sentry` | billing form + Sentry stub | all four observability taps into one sink: wire breadcrumbs, claim trail with owner, severity-routed server capture, incident-id correlation across the wire |

Rung 4 reuses rung 3's server and proves the router mapping: pathless layout
routes mount the session and viewer shells, the doc route claims
`doc/not-found`, `errorComponent` is the escalate target, and each layout's
loader prefetches its layer's context procedure — the first committed paint
renders session, viewer, and doc with no fallback states.

Rung 3's test file ends with compile-time probes: the doc query — which
resolves nine possible failures — has a component-visible union of exactly
`"doc/not-found"`, and the rename mutation presents exactly its three domain
outcomes (`doc/not-found | doc/locked | doc/forbidden`). Domain errors stay
with the component; only the framework tiers are claimed above.

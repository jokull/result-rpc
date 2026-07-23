# Examples

An escalation ladder. Each rung is a self-contained app with runtime tests
(`bun test examples/<rung>`), and every file typechecks under the repo's strict
`pnpm check` — the examples are the library's DX regression suite.

| Rung | App | Exercises |
| --- | --- | --- |
| `01-hello` | greeting service | minimal path: one error, one query, provider + hook |
| `02-todo` | todo list | mutations, optimistic rollback, app/defect shells, `errorCatalog` |
| `03-trips` | trip planner | `defineService` graph, `defineLayer` + `require`, five-layer onion, feature shell, subscription, escalation boundary |

Rung 3's test file ends with compile-time probes: the rename mutation — which
declares `Unauthorized | TripNotFound | TripLocked` plus six transport tags —
has a component-visible failure union of exactly `"trip/locked"`, and the trip
query's is `never`.

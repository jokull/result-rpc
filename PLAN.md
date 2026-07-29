# Publish-readiness type plan

This plan turns the independent TanStack-style type review into release gates.
The governing rule is that runtime validation remains defense in depth; it must
not compensate for a public type that promises something untrue.

## P0 — soundness

- [x] Preserve root-context requirements through router construction and
      contract implementation. A factory may provide more context than a
      procedure needs, never less.
- [x] Make `WireCodec` variance honest. A codec for `string` must not widen to
      a codec accepting `string | number`.
- [x] Replace the fake empty-object type. Zero-input procedures and data-free
      errors may omit input, but must reject primitives statically.
- [x] Give pagination an explicit associated capability. Unary and paginated
      query APIs must be mutually exclusive, and `.affects()` maps list input,
      not a full page request.
- [x] Make `updateEntity` projection-safe. An updater may rely on identity and
      optional model fields, never on a complete canonical row.
- [x] Make shell claims definition-safe. Each shell retains its exact definition
      map and exact parent; tags only locate candidates, full signatures drive
      static subtraction, and definition identity drives runtime ownership.

## P1 — composition

- [x] Enforce contract-first middleware error and header obligations at
      compile time while retaining runtime checks.
- [x] Make `LayerValue`, `LayerErrors`, and `AnyLayer` work for both base and
      refined layers.
- [x] Fix service cycle detection for async sibling/back-edge graphs.
- [x] Give zero-input subscriptions the same omission ergonomics as unary
      procedures.
- [x] Reject conflicting definition-map composition statically where TypeScript
      can identify the conflict; keep identity checks at runtime.

## P2 — developer experience

- [x] Replace important `never` cliffs with named constraint diagnostics for
      model selections, layer-shell compatibility, and middleware obligations.
- [x] Compile the strongest public type suite against a packed installation and
      exported subpaths, not only `src`.

## Crown jewel — shell subtraction

- A shell value retains the same `claims` map and `parent` chain used by its
  providers at runtime. `ClaimedErrorsBy<TShell>` derives the union recursively
  from those values; there is no parallel handled-union generic to widen.
- `SubtractClaimedErrors` distributes over the procedure error union and compares
  the complete public signature. Same-tag errors with different, wider, or
  narrower data stay in the residual union.
- A typed definition registry is the single runtime authority for ambient
  claiming, held-error callbacks, and `$errors.is`. Exact definition predicates
  reject even a separately declared error with an identical tag and payload.
- Shell wrappers forward the original hook argument tuple unchanged. Query,
  suspense, pagination, mutation, and subscription all preserve their procedure
  inference; zero-input omission survives the wrapper.
- Public type fixtures prove every nesting stage, untouched-member preservation,
  callback/full-union behavior, same-tag near misses, and every hook family.

## Type standard

Reference checkout: `~/Forks/router` at TanStack Router/Start commit `a3ee355`.

- Exact values carry associated facts forward; later arguments validate those
  facts with `NoInfer` and never reopen producer inference.
- Illegal states should disappear from fluent APIs. When a mismatch must remain
  callable for contextual inference, report a branded `RpcConstraintError`
  instead of collapsing to `never`.
- Structural checks prove compatible public shapes; runtime registries prove
  exact definition identity and validate erased wire boundaries.
- Public overloads own exact relationships. Assertions are confined to erased
  implementations where runtime validation supplies the missing proof.
- Avoid giant positional generic lists, `{}` as an empty type, blanket `as any`,
  global registration in core APIs, and type tricks without type-performance
  fixtures.

## Acceptance gates

- [x] Each P0 issue has a negative compile-time fixture and a runtime defense
      test.
- [x] `pnpm check`, `pnpm lint`, and `pnpm test:types` pass.
- [x] All runtime and adversarial entity tests pass.
- [x] `tsdown`, `attw`, and `publint` pass.
- [x] The packed package passes Vite 8 development and production consumers.
- [x] The production demo proves server modules stay out of browser assets.
- [x] Contract/client and nested-shell type costs have independent linear-growth
      baselines, and `pnpm bench:types` passes.
- [x] Documentation checks and static build pass.

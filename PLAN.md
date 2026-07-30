# Pre-release correctness plan — review wave 6

This plan replaces Wave 5. The fresh installed-package review verified the
supersession fix on React 18.3.1 and 19.2.8, then found that a claimed
first-render Suspense retry still had no committed lifecycle owner. The fix is
to make the Suspense boundary itself own those leases.

## Governing invariant

Every shell holding has a committed owner. Ordinary hooks own opaque leases in
their committed effects. A Suspense query that may be claimed uses a committed
`ResultSuspense` boundary lease because a child that suspends before commit can
never install cleanup. Request settlement remains cache-only.

## P0 — committed Suspense claim ownership

- [x] Add `ResultSuspense`, a drop-in Suspense boundary with an opaque claim
      lease and effect-owned cleanup.
- [x] Require a claimed `useResultSuspenseQuery` to be beneath
      `ResultSuspense`; fail clearly instead of silently leaking under a plain
      React boundary.
- [x] Make separately removable branches separately owned, so removing one of
      two same-key boundaries preserves one lease and removing the second
      drains the holding.
- [ ] Pin `resetKey` replacement and distinct-key partial removal.
- [ ] Document the ownership scope: independently removable branches need
      distinct boundaries; `resetKey` replaces a retained boundary's scope.
- [ ] Verify installed consumers on React 18.3.1 and 19.2.8.

## Release gates

- [x] Source type-check and focused React/shell tests pass.
- [ ] Public type fixture and API reports include the new boundary.
- [ ] Full `pnpm verify:release` passes.
- [ ] A fresh blind installed-package review finds no publish blocker and
      judges the package publish-grade, with type quality comparable to serious
      TanStack work for this library's scope.

## Prior evidence to preserve

- Suspense settlement cannot acquire a holding from an async continuation.
- Abandoned and superseded request generations own nothing.
- Same-key ordinary and Suspense claims aggregate while committed leases retire
  independently.
- Exact nested shell subtraction, definition identity, procedure/input
  correlation, erased error reconstruction, contract stamps, clean browser
  graphs, and package navigation remain intact.

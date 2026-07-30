# Pre-release correctness plan — review wave 9

This plan replaces Wave 8. The fresh installed-package reviewer verified every
owned and residual mutation retry form on React 18/19, package/type/build
boundaries, and again judged the public TypeScript architecture and DX at a
serious TanStack Router/Start standard for this scope. Publication is held on
one localized runtime integration defect.

## Governing invariant

Exact-definition mismatch is a programmer error, but every callback delegated
to TanStack Query must be total. Detection may happen inside retry/observer
machinery; throwing must happen only through a controlled imperative promise
or React render/error-boundary path. No typed callback may receive the
incompatible value in between.

## P0 — total owner resolution at external callback boundaries

- [x] Split owner lookup into a non-throwing exact resolution
      (`unclaimed | owned | incompatible`) and a fail-loud throwing facade.
- [x] Use non-throwing resolution in mutation retry, failure/settled callbacks,
      and observer notification so no exception escapes TanStack retry/cache
      callbacks.
- [x] Keep `claimOwner` throwing for imperative mutation continuation and
      React render projection, preserving the precise shell/tag diagnostic.
- [x] On incompatibility, make exactly one request, invoke only `onCancel` for
      local optimistic cleanup (never consumer retry/failure/settled, shell
      reaction, holding, or claimed event), and reject `mutate()` with the
      diagnostic TypeError; a rendered failure must reach the nearest React
      error boundary rather than the process.
- [x] Preserve owned and residual retry counts, callback freshness, optimistic
      cleanup, claimed control flow, pause/escalation behavior, and query
      mismatch behavior.

## Installed-package proof

- [x] Add source regressions for `Shell.useMutation` and plain
      `useResultMutation` beneath a colliding shell on React's current line.
- [x] Extend packed React 18.3.1 and 19.2.8 smoke with both collision hook
      forms, asserting controlled rejection/boundary delivery and no unhandled
      rejection.
- [x] Extend packed smoke with residual retry counts `1/3/2/4` and retry
      callback freshness across attempts, preserving Wave 9's independent
      positive evidence.
- [x] Focused formatting, lint, source/public types, API reports, query/React
      runtime, and package smoke pass.
- [x] Full `pnpm verify:release` passes, including TS 5.4/5.9/7, React 18/19,
      Vite 8, Next 16, Worker, entity performance, type scaling, and docs.

## Fresh verdict gate

- [ ] A new blind reviewer packs the post-fix artifact, independently proves
      controlled same-tag mutation mismatch on React 18.3 and 19.2 through
      both hook forms, reruns retry/callback adjacency, and finds no release
      blocker across the complete package.
- [ ] That reviewer gives an unqualified yes that the exact artifact's public
      TypeScript architecture/DX remains at a serious TanStack-quality standard
      for this library's scope.

## Prior evidence to preserve

- Owned retry counts `1/1/1/1`; residual counts `1/3/2/4`; shell/plain parity;
  exact residual callback/state/promise types and ambient full-union honesty.
- Optimistic rollback, claimed sentinel/idle state, pause-only
  reaction/holding/event, exact tagged escalation with zero pause observation.
- `ResultSuspense` same/distinct/reset/abandon/supersede/Strict ownership across
  React 18.3 and 19.2.
- Procedure/input correlation, exact nested subtraction, tagged reconstruction,
  privacy/skew/hydration/entity contracts, clean package graphs, TS
  5.4/5.9/7, and controlled scaling.

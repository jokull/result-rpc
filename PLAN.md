# Pre-release correctness plan — review wave 7

This plan replaces Wave 6. The fresh installed-package reviewer verified the
new `ResultSuspense` ownership model across React 18.3.1 and 19.2.8 and judged
the inference/scaling architecture excellent, then held publication on two
public lifecycle-contract mismatches.

## Governing invariant

Runtime discharge and public subtraction are one contract. A shell hook must
not deliver a claimed error through a callback whose type says that error was
removed. Pause ownership has shell reactions, holdings, and `claimed`
breadcrumbs. Escalation delegates the exact tagged error to React's error
boundary; it does not pretend to create a pause holding or shell reaction.

## P0 — mutation callbacks discharge with shell ownership

- [ ] Make ambient mutation lifecycle callbacks consult the mounted claim
      scope before invoking consumer callbacks.
- [ ] For a claimed failure, suppress `onFailure` and failure `onSettled`, do
      not invoke a consumer retry predicate, and invoke the control cleanup
      callback used for optimistic rollback.
- [ ] Type `Shell.useMutation` callback errors/results with the same exact
      residual union as its returned state and `mutate()` result.
- [ ] Preserve full callback unions for plain hooks as a sound
      over-approximation, while ambient runtime claiming still suppresses an
      owned failure beneath a mounted provider.
- [ ] Pin callback freshness, exact same-tag/different-definition behavior,
      optimistic cleanup, claimed rejection, and ordinary unclaimed failure.

## P0 — make escalation observability truthful

- [ ] Define `onError` as a pause reaction and reject it at the type level for
      `effect: "escalate"`.
- [ ] Narrow the public `claimed` ClientEvent to pause ownership; escalation is
      observed by the React error boundary receiving the exact tagged instance.
- [ ] Update README, docs, architecture, examples, public fixtures, and API
      reports so no text or type promises an escalation claim breadcrumb or
      shell reaction.
- [ ] Pin pause reaction/breadcrumb behavior and escalation's exact throw,
      zero holding, and absence of a pause breadcrumb.

## Lifecycle hygiene

- [x] Boundary leases forget released operations instead of retaining their
      IDs until a long-lived boundary unmounts.
- [ ] State and test that a failed recovery attempt is a fresh claim and may
      re-fire an idempotent pause reaction.
- [x] Release automation runs the packed ResultSuspense matrix on React 18.3.1
      and 19.2.8 and enables strict optional/indexed access in package types.

## Release gates

- [ ] Focused runtime and public type regressions pass.
- [ ] API reports and docs are updated and strict/link/static checks pass.
- [ ] Full `pnpm verify:release` passes, including installed React 18/19,
      TS 5.4/5.9/7, Vite 8, Next 16, Worker, entity, and type-scaling gates.
- [ ] A new blind installed-package review finds no release blocker and judges
      both the complete package and its public TypeScript architecture/DX at a
      serious TanStack-quality standard for this library's scope.

## Prior evidence to preserve

- `ResultSuspense` same-key, distinct-key, reset, abandonment, supersession,
  Strict replay, and resume ownership.
- Exact nested shell subtraction and same-tag/different-definition identity.
- Procedure/input correlation, tagged reconstruction, private sanitization,
  contract stamps/skew, clean browser/server graphs, hydration, entity
  coherence, and package navigation.

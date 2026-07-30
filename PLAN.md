# Post-0.1.0 plan — first external adopter

This plan replaces the pre-release wave plans (Wave 10 closed clean; `0.1.0` is
published). The work below comes from the first external port of a real feature
onto result-rpc — a themes app on TanStack Start + D1 + iron-session — reported
after the author read the full docs and the `11-tanstack-start` example.

What the port validated, recorded because it decides what _not_ to touch: the
closed error union split one `throw new Error("Unauthorized")` into
`auth/required` vs `theme/not-owner` and surfaced a design bug the author had
not planned to fix; layers deleted three artifacts that had to agree and did
not; entities removed every `revalidatePath`. Net −1012 lines. None of that
changes.

## Governing invariant

A declared domain error is a **value**. Everything below follows from applying
that consistently: a value may be dehydrated, a value must not arrive as a
rejection, and a difference that is not a difference in values (`readonly`) is
not a mismatch.

## P0 — a declared failure is part of the answer

Reported as: a 404 detail page server-rendered an empty body and only said
"not found" after a client round-trip. `dehydrate` keeps successes only
(`src/query/runtime.ts:1829`, `status === "success"`).

That rule is right for `client/network-failure` — transient, do not bake it in —
and wrong for `theme/not-found`, which is not a failed prefetch but the answer.
The current behaviour contradicts the library's own first pillar.

- [x] Dehydrate queries whose failure is a **declared domain error**; keep
      excluding framework and transport failures.
- [x] Hydrate them back as failures, reified through the procedure's registry
      like any wire error, so shells claim them exactly as they would live.
- [x] Regression: an RSC prefetch of a not-found row renders the domain failure
      on first paint at **zero** client requests, and a prefetch that failed on
      a transport error still hydrates as absent rather than as a baked-in
      failure. Two runtime details worth keeping: a successful query carries
      `error: null` rather than `undefined`, and `fetchFailureReason` holds the
      same instance — a retry detail about one attempt, dropped rather than
      translated.
- [ ] Document the rule in the RSC guide, replacing the workaround this
      currently forces adopters into.

## P0 — `mutate()` must not reject

Reported as the sharpest edge, and confirmed worse than reported: our own
`concepts/entities.md:30` documents
`onChange={(e) => void assign.mutate({ … })}`, and `void` on a rejecting promise
is an unhandled rejection. `src/react/index.tsx:874` throws `claimed(...)`
whenever a mounted shell owns the outcome, so the documented call site is
correct only in an app where nothing claims.

The intent — a caller's continuation must not run on an outcome a shell owns —
stays. Only the delivery changes, to the split TanStack Query already
established and adopters already know.

- [x] `mutate(input)` is fire-and-forget: returns `void`, never rejects.
- [x] `mutateAsync(input)` returns `Promise<Result<…>>` and rejects with the
      `claimed` signal. `MutationControls` and `ResultMutationObserver` both
      carry the pair, so the runtime and the hook agree.
- [x] Regression (`src/react/mutate-rejection.test.tsx`): a claimed mutation
      under a mounted shell raises no unhandled rejection through `mutate`, and
      still rejects through `mutateAsync`. Verified by restoring the old
      behaviour — both fail.
- [x] Call sites updated across examples and tests. The `void x.mutate(…)
.catch(() => undefined)` incantation in 07-tracker and 08-bookings is
      gone, which was the point.
- [ ] **Docs not yet updated.** `concepts/entities.md:30` still shows
      `void assign.mutate({…})`; `concepts/mutations.md` and
      `concepts/shells.md` await the result and need `mutateAsync`. The docs
      typechecker only compiles blocks that import `result-rpc`, and these are
      fragments, so it will not catch them — they must be found by reading.
- [ ] Release notes: this is breaking. `mutate()` no longer returns a Result.

## P1 — `$satisfies` should not fail on `readonly`

Reported as: failed on `colors` with
`{ "Model fields missing or incompatible in source": "colors" }` and no
indication the mismatch was `readonly`; found only by passing a deliberately
wrong argument to make the compiler print the expected type.

`ModelTypeEqual` (`src/model.ts:142`) is strict structural identity, so a codec
decoding to `readonly string[]` never matches a source column typed `string[]`.
Wire codecs decode readonly by design — so this fires on correctly-aligned
schemas, which is the definition of a false positive.

- [x] Compare modulo `readonly`: normalize both sides before the identity test,
      leaving genuine differences failing exactly as now.
- [x] Preserve nullability strictness. `string` vs `string | null` stays a
      mismatch; that is the check earning its keep.
- [x] Diagnostic resolves to string literals rather than a structural type.
      Research settled this: TypeScript prints a type alias by _name_ when one
      exists, so the carefully built `{ model, source }` object showed up as
      `SourceFieldMismatch<Model, Row>` and told the reader nothing. The earlier
      probe only looked informative because the source was an anonymous inline
      type. Literals print verbatim; nullable unions need a non-distributive
      printer or `string | null` becomes two messages each claiming the type is
      something it partly is not. Prior art: Drizzle's
      `DrizzleTypeError<Message>`, ArkType's zero-width-space brand,
      expect-type's `MismatchInfo`.
- [x] Type-perf: `modelSelection` unchanged at 50 instantiations/unit.
- [x] Regression: `readonly` differences pass; nullability, scalar, missing
      fields and wrong array elements still fail; the message names every
      offending field and both sides.
- [ ] **Open**: the message still requires hovering or passing an argument.
      Moving it into the type parameter's constraint would print it on the bare
      call, but `TSource extends …TSource…` is a circular constraint (TS2313)
      inside an interface method with an enclosing type parameter — the standalone
      generic function the research validated does not transfer. Worth another
      attempt; not worth thrashing on now.

## P1 — `wire.nullable`

Reported as: `wire.union([X, wire.null])` written constantly. Confirmed absent.

- [x] `wire.nullable(codec)` with the encoding of the union it replaces —
      pinned by a test asserting the same `kind`, so the contract digest cannot
      move.
- [ ] Use it in the docs where the union spelling appears.

## Not doing

- **`.all("reason")`.** Reported as theatre: the sentence is written by whoever
  already decided, so it is a speed bump rather than a gate. Half right — it does
  not constrain, and `concepts/entities.md:221` already claims only that it
  "costs a sentence that lands in review", which is an audit trail and a diff,
  not enforcement. Removing it returns the self-profile case to enumerating every
  field by hand, which is how the leak it exists for happened. Keep it; keep
  describing it as exactly what it is.
- **Mutable decode shapes.** `readonly` output is correct and stays. P1 removes
  the place it caused a false failure, which was the actual complaint.

## Follow-up, not blocking

- [ ] The adopter could not exercise authenticated writes or optimistic
      `updateEntity` patches (`/api/dev-auth` 403s locally). The library side is
      covered — `attack-08-rollback-and-notify` pins rollback under interleaving
      and object identity, `attack-13-concurrent-optimistic` pins that a stale
      authoritative response never clobbers a newer confirmed write — so the
      untested surface is their wiring, not the patch engine. Worth telling them.

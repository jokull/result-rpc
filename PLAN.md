# Pre-release correctness plan

This plan replaces the completed type-architecture hardening plan. A blind
reviewer approached the repository as a new consumer, reproduced five failures
outside the repository, and recommended holding publication. Those findings
are now the release boundary.

The library is pre-release. Public APIs, wire envelopes, cache identity formats,
and type signatures may change freely. Do not preserve a weaker design for
compatibility with code nobody depends on yet.

## Governing invariants

1. A shell may subtract an error only when a mounted runtime owner has already
   accepted that exact error definition and owns its complete lifecycle.
2. Two distinct model identities must never share an internal cache key.
3. No hydrated value or stream event may be accepted before the client proves
   that it speaks the same effective contract as its producer.
4. A procedure value and its input remain one correlated fact, including when
   either appears in a union.
5. Public declarations describe guarantees the runtime actually enforces.
   Runtime validation defends erased boundaries; it does not excuse a type lie.

Every fix needs three proofs:

- a focused regression reproducing the original failure;
- an adversarial family around the boundary, not only the reported example;
- a packed-consumer or production-build proof when declarations, transport, or
  package graphs are involved.

## P0 — shell-owned Suspense must not deadlock

### Verified failure

`useAmbientClaim` currently reports a pause claim from a React effect, while
`useResultSuspenseQuery` suspends as soon as it sees that claim. The component
never commits, the effect never runs, the shell remains unaware, and the promise
being awaited never resolves.

Observed by the blind probe after 100 ms:

```json
{ "rendered": "loading", "affected": 0, "onErrorCalls": 0 }
```

### Work

- [x] Commit the minimal claimed-Suspense reproduction as a failing React test.
      Assert rendered fallback, shell holdings, reaction calls, and eventual
      recovery rather than relying on a snapshot.
- [x] Move claim acquisition out of a descendant effect that can be prevented
      from committing. The preferred design is an observer-to-shell bridge:
      the query observer reports an exact claimed failure to the mounted shell
      node before notifying React of the state that will suspend.
- [x] Give every acquisition a stable operation identity and an explicit
      release path. Rendering, Strict Mode replay, abandoned renders, observer
      replacement, and unmount must not leak phantom holdings.
- [x] Keep React render and `useSyncExternalStore.getSnapshot` pure. Do not fix
      the deadlock by mutating shell state during render.
- [x] Unify ordinary query, Suspense query, paginated query, mutation, and
      subscription claim delivery behind one lifecycle protocol. Hook-specific
      timing must not change ownership semantics.
- [x] Decide what Suspense waits for. A claimed failure should wait on the
      shell's resume/release epoch, retry once the condition is repaired, and
      never turn into a permanently pending promise.
- [x] Prove `pause` and `escalate` separately. Escalated errors go to an error
      boundary; paused errors go to the exact shell owner and Suspense fallback.

### Exit criteria

- [x] A first-render, background-refetch, and hydration-adjacent claimed failure
      all reach the shell before the subtree becomes indefinitely suspended.
- [x] `affected`, `errors`, `latest`, `onError`, `resume`, and teardown remain
      correct with siblings, nested shells, Strict Mode, and rapid remounts.
- [x] Shell hook error subtraction is unchanged and still backed by exact
      definition identity at runtime.

## P0 — make entity identity injective

### Verified failure

Identity currently stringifies parts and joins them with `:`. Therefore:

- `{ id: "a:b", locale: "c" }` collides with
  `{ id: "a", locale: "b:c" }`;
- numeric `1` collides with string `"1"`;
- one `updateEntity` can patch multiple logical records.

This is cache corruption, not merely an inconvenient public helper.

### Work

- [x] Commit collision regressions that prove collection, lookup, patching,
      invalidation, optimistic rollback, hydration reindexing, and subscription
      updates never cross identities.
- [x] Define one canonical, injective identity encoding over
      `[modelName, ...keyParts]`. Preserve type, arity, segment boundaries, and
      all supported numeric edge cases. Prefer a length-delimited or canonical
      typed-tuple encoding over delimiter escaping.
- [x] Use the same encoder for `entityIdOf`, `entityIdFor`, `entityKey`, touched
      metadata, cache indexes, writes, invalidation, and debug output. Delete
      parallel key construction.
- [x] Introduce an opaque `EntityId<TModel>`/internal cache-key distinction if
      it prevents raw strings from being confused with encoded identities.
- [x] Remove acceptance of arbitrary pre-joined composite strings unless they
      can be validated as the new canonical encoding. There is no compatibility
      reason to retain the ambiguous form.
- [x] Specify which wire scalars may be model keys. Reject values whose identity
      semantics cannot be made stable across JavaScript realms and serialization.

### Exit criteria

- [x] Property-style generated tests find no collisions across model names, scalar types,
      composite arities, delimiters, Unicode, empty strings, and supported
      numeric boundary values.
- [x] A patch or invalidation for one identity touches exactly that identity in
      nested objects, arrays, maps, sets, projections, subscriptions, and
      hydrated caches.
- [x] The 200-by-1000-row performance test remains within its explicit budget.

## P0 — bind hydration to the effective contract

### Verified failure

`DehydratedQueryRuntime` contains only `v`, `serializer`, and `payload`.
Hydration accepted data from a router with a different contract digest and
served `"OLD-BUNDLE"` without making a request, despite the RSC documentation
claiming contract-skew protection.

### Work

- [x] Commit a cross-contract hydration regression using two decodable but
      semantically different routers. Assert that stale data never enters the
      cache and the current client fetches fresh.
- [x] Define one `EffectiveContractVersion` used by HTTP, streams, direct server
      clients, browser clients, dehydration, and hydration. A configured build
      stamp and an automatic contract digest must not compete or drift.
- [x] Register that version as exact client metadata when clients are created;
      `createQueryRuntime` must obtain it from the concrete client identity.
- [x] Add the version to `DehydratedQueryRuntime` and validate it before parsing
      or merging the payload. Remove support for the unstamped envelope.
- [x] Give direct server callers and browser clients identical dehydration
      semantics so an RSC-prefetched payload is accepted by its matching browser
      contract and rejected by every other one.
- [x] Keep the React hydration boundary fail-soft: a mismatch emits one useful
      development diagnostic and fetches fresh without crashing the tree.

### Exit criteria

- [x] Same-contract RSC hydration renders on first paint with zero browser
      requests; every mismatched contract performs a fresh request.
- [x] Nested hydration boundaries cannot mix versions silently.
- [x] Hydration mismatch behavior is tested in source, packed Next, and the
      production Worker demo.

## P0 — subscriptions participate in contract-skew handling

### Verified failure

The server stamps streaming responses, but `TransportStreamResponse` discards
the contract header. Unary calls emit `skew`; subscriptions from the same stale
client emit success and no skew event. Contract-shaped stream failures therefore
cannot become `client/stale`, and `StaleShell` cannot own them.

### Work

- [x] Commit a unary-versus-subscription parity regression using intentionally
      different client and server versions.
- [x] Carry the effective contract version through the transport stream
      handshake. A successful custom transport stream must provide the same
      metadata as fetch transport.
- [x] Reconcile the version before exposing the first stream item. On mismatch,
      close the underlying iterator/reader, emit one skew event, and produce the
      same `ClientStale` semantics as unary calls.
- [x] Centralize unary and streaming reconciliation so event ordering,
      once-per-client reporting, and error construction cannot diverge again.
- [x] Prove cancellation, abort, early consumer return, malformed frames, and
      mismatch all close resources exactly once.

### Exit criteria

- [x] Unary, batch, and subscription calls agree on contract mismatch behavior.
- [x] `StaleShell` owns a stale subscription without surfacing an impossible
      residual error union or reconnect loop.
- [x] Browser and Worker bundle checks remain free of server implementation code.

## P1 — preserve procedure/input correlation across unions

### Verified failure

The emitted declarations accept this unresolved union:

```ts
const selected = condition ? client.byId : client.byPage;
runtime.observe(selected, { id: "doc-1" });
```

If `selected` is `byPage`, the input is invalid. Independent projections from a
union have lost the relationship carried by each procedure's associated record.

### Work

- [x] Add packed TypeScript 5.4, 5.9, and 7.0 negative fixtures for union-valued
      query, paginated-query, mutation, and subscription clients.
- [x] Prototype a distributive correlated argument union:
      `[procedure, input, options?]` for each procedure member. Prevent later
      arguments from reopening inference with `NoInfer` or an equivalent
      producer-first constraint.
- [x] If TypeScript still admits an unresolved union through generic inference,
      reject it with a named
      `RpcConstraintError<"procedure-union-must-be-narrowed", ...>` rather than
      silently accepting an unsafe call.
- [x] Apply the chosen algebra consistently to runtime observation, React hooks,
      cache get/update/invalidate, prefetch, pagination, mutations, and
      subscriptions. Do not patch only `observe`.
- [x] Preserve zero-input omission and ordinary single-procedure inference.
      Dynamic code narrows the procedure first. A distributive tuple prototype
      rejects mismatched pairs, but a union of valid tuples cannot be spread on
      every supported TypeScript version; adding a parallel bound-call API for
      that edge case would make the common operation API worse.

### Exit criteria

- [x] The reported call fails at the procedure/input pair with a readable
      diagnostic on every supported TypeScript version.
- [x] Narrowed branches compile with exact output and error unions, including
      shell subtraction; unresolved procedure unions fail before independent
      input unions can form.
- [x] Type-performance profiles remain within their committed slopes.

## P1 — complete runtime ownership and observability

### Provider-owned query runtimes

- [x] Add a lifecycle test proving a provider-created runtime unmounts Query Core
      subscriptions and timers when its provider unmounts.
- [x] Separate owned and borrowed runtime lifetimes explicitly. Providers clear
      only runtimes they created; externally supplied runtimes remain caller-owned.
- [x] Prove Strict Mode replay, client replacement, and remount do not double
      mount, clear a borrowed runtime, or retain listeners.

### Server `onError` completeness

- [x] Inventory every HTTP and stream response exit: body limits, batch limits,
      context creation, codec throws, unknown paths, kind mismatches, handler
      failures, private sanitization, and protocol failures.
- [x] Route every wire-crossing tagged failure through one response finalizer
      that invokes `onError` exactly once with its projected status and procedure
      path when known.
- [x] Keep programmer defects and internal incidents on `onInternalError`; do
      not manufacture recoverable error events for arbitrary thrown values.
- [x] Add a table-driven parity test covering every exit path.

## P1 — make automatic contract digests structural

The current digest records codec `kind`, so two object schemas with different
fields can hash identically. An explicit build stamp can cover this operationally,
but the automatic digest must not imply a precision it does not possess.

- [x] Define a stable runtime schema descriptor/fingerprint for every built-in
      codec, including object fields, optionality, unions, records, entities,
      pagination, error data, header capability, and procedure kind.
- [x] Require adopted Standard Schema/custom codecs to supply an explicit stable
      schema identifier when structural introspection is impossible.
- [x] Compute contract digests from canonical descriptors, not display-oriented
      `kind` strings or object iteration accidents.
- [x] Decide the configured version contract: either a build stamp composes with
      the structural digest or it replaces it under an explicitly named API.
      The same rule must feed HTTP, streams, and hydration.
- [x] Add golden stability tests plus one-change-at-a-time sensitivity tests.

## P2 — declaration and release hygiene

- [x] Stop suppressing API Extractor `ae-forgotten-export` findings. Export a
      useful inspection type, inline the relationship, or restructure the
      signature so public declarations do not depend on private aliases.
- [x] Review `ProvidedShellOptions`, `LayerQueryProcedureClient`,
      `ShellClaimCompatibility`, and every other forgotten type in all seven
      API reports.
- [x] Add documentation comments to intentional public APIs; keep internal
      carriers out of autocomplete without leaving dangling declaration names.
- [x] Keep `ResultRpcReact<TClient>` and `LayerShellFactory<TClient>` as the clean
      public scoped-binding surface unless the union-correlation work proves a
      better associated-record design.
- [x] Turn the explicit entity wall-clock test and `bench:types` into a
      `verify:release` command rather than a developer remembering environment
      flags.
- [x] Include website strict checking, link validation, and static generation in
      that release command.
- [ ] Re-run an independent blind review after every P0 is closed. The reviewer
      receives no plan or implementation narrative—only the package and claims.

## Required implementation order

1. Commit all five reported failures as regressions without changing behavior.
2. Fix entity identity first because the current representation can corrupt
   unrelated cached data.
3. Establish one effective contract-version primitive, then use it for
   hydration and subscriptions.
4. Redesign claim delivery and prove shell-owned Suspense end to end.
5. Close procedure-union correlation across the whole client/query/React API.
6. Complete lifecycle, observability, structural digest, and declaration work.
7. Run the full release matrix and a fresh blind audit.

## Release gates

- [x] Every reported blind-review reproduction exists in the repository and
      fails against the pre-fix behavior for the stated reason.
- [x] All P0 and P1 exit criteria pass; no correctness item is waived as
      documentation.
- [x] `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test:types`, and
      `pnpm test:diagnostics` pass without warnings.
- [x] All runtime, React, protocol, entity, adversarial, and production demo
      tests pass; intentional skips are documented and run by `verify:release`.
- [x] TypeScript 5.4, 5.9, and 7.0 packed consumers compile every public subpath.
- [x] Vite 8 browser/Worker dev and production builds plus Next RSC/client dev
      and production builds pass; browser graphs contain no server modules.
- [x] All type-performance profiles and the entity wall-clock profile remain
      within reviewed baselines.
- [x] `tsdown`, `attw`, `publint`, and all seven API reports pass with no
      suppressed forgotten-export failure.
- [x] Documentation claims match the implemented hydration, streaming, shell,
      identity, and digest guarantees; strict check, links, and static build pass.
- [ ] A fresh blind TypeScript/TanStack review finds no publish blocker.

## Foundation to preserve

- One associated `ProcedureTypes`/`ProcedureClientTypes` record carries exact
  procedure facts through contracts, implementations, clients, and hooks.
- Shells validate exact definition identity, reject duplicate ownership, and
  eagerly prove the mounted parent chain.
- Fluent procedure and middleware typestate makes illegal states unavailable
  and reports named `RpcConstraintError` diagnostics.
- Wire decoding, declared-error verification, private-error sanitization,
  bounded serialization, and malformed producer containment fail closed.
- Shared, server, client, query, React, database, and testing entry points have
  clean package boundaries and browser/server graph tests.
- The existing adversarial cache suite, randomized coherence oracle, packed
  compiler matrix, API reports, and type-performance profiles remain mandatory.

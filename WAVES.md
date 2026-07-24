# WAVES — entity identities implementation ledger

Working ledger for implementing PLAN.md. One wave = one coherent, verified
increment. Status: `pending` → `in-progress` → `done (commit)`.

## Wave 0 — plan amendments `done`
- [ ] Fold the burden analysis into PLAN.md (burden table, decision table)
- [ ] Add `.writes(Model, map)` escape hatch to the design
- [ ] Add `Model.pick()` and the shape-based `defineModel` API
- [ ] Record the registry deviation (no hard build-time name collision check
      in v1 — module-scope registry breaks HMR/test processes; documented as
      a sharp edge instead)

## Wave 1 — models and collection `done`
- [ ] `src/model.ts`: `defineModel(name, { key, shape })` → canonical codec,
      `pick()`, decode-time entity branding (WeakMap, global, race-free)
- [ ] `collectEntities(value)` — walk decoded values for branded objects,
      recording `{model, id, path, value}`; arrays + plain objects traversed;
      Map/Set members collected without patchable paths (invalidate-only)
- [ ] Codec `kind` carries the model name (`model(doc)`) → digest picks it up
- [ ] Tests: nested/array/shared-ref collection; pick requires the key field;
      no branding without decode

## Wave 2 — stage 1: identity invalidation `done`
- [ ] Runtime entity index: query-cache event subscription → reindex on
      success data, drop on eviction
- [ ] Mutation success → collect output entities → invalidate containing
      queries
- [ ] `cache.invalidateEntity(Model, id)`
- [ ] `.writes(Model, map)` on the procedure builder (mutation-only,
      manifest-carried, digest-excluded like `.affects`)
- [ ] Tests: exact containment invalidation; writes-declared invalidation;
      eviction drops index entries

## Wave 3 — stage 2: write-through patches `done`
- [ ] Structural patch at recorded paths: identity-preserving clone
      (files.ts pattern), projection merge rule (merge only keys the cached
      object has), patched objects re-branded
- [ ] Patch-else-invalidate: patch when paths + overlap apply, invalidate
      otherwise
- [ ] `cache.updateEntity(Model, id, fn)` with rollback closure (composes
      with `optimistic:`)
- [ ] Tests: zero-refetch flagship (transport spy proves no query request
      after mutation), projection merge preserves exact shapes, cycles/shared
      refs, optimistic create under a client-minted id (success ≈ no-op)

## Wave 4 — stage 3: server-declared writes `pending`
- [ ] `touch` in handler args (`({ input, context, errors, touch })`)
- [ ] Envelope sidecar: `touched: ["user:u_1"]` — identities only, never
      values; tolerant decode (old clients ignore)
- [ ] Client → runtime conveyance (WeakMap keyed by the Result object) →
      invalidate by identity; covers deletes and cascades
- [ ] Tests: touch invalidates without output entities; deletes; old-client
      tolerance

## Wave 5 — docs, example, probes `pending`
- [ ] README: "Entities" section (profile-pic demo, division of labor,
      client-minted ids, fractional-index pattern, decision table)
- [ ] ARCHITECTURE: entity index design + normalized-store non-goal
- [ ] Example rung: avatar-in-the-header zero-refetch assertion; client-id
      optimistic create; sortKey reorder
- [ ] Compile-time probes: `updateEntity` typed by canonical codec
- [ ] Sharp edges: model name collisions (reference identity), silent
      non-collection miss

## Deviations from PLAN.md
(recorded as they happen)
- Wave 1: dropped recorded paths entirely — patching walks cached values and
  replaces branded objects by identity, which makes shared refs, cycles, and
  Map/Set members uniform (PLAN said Map/Set would be invalidate-only; no
  longer a limitation). Cost: a patch clones the affected value tree
  unconditionally; ancestor-only cloning is a later optimization.
- Wave 1: an entity whose untouched field references itself keeps the OLD
  reference after a merge (self-cycle through the entity node) — pathological,
  accepted.

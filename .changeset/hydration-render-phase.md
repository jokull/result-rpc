---
"result-rpc": patch
---

Hydration no longer writes to the query cache from inside React render.

`ResultRpcHydrationBoundary` and the provider's `hydrate` prop used to merge
and re-decode the **whole** cache during render, and `useResultQuery` re-decoded
its own cached success on first observe. Both notified already-mounted
observers mid-render — React's "Cannot update a component while rendering a
different component" — whenever a nested boundary mounted later, the `hydrate`
prop changed identity, or a second component started observing an
already-cached key.

- `runtime.hydrate()` normalizes only the entries the payload actually wrote;
  queries outside the payload (or already newer in the cache) are untouched and
  their observers are not notified.
- The React bindings hydrate in two phases: keys the cache has never seen merge
  during render (nothing observes them, so first paint still has server data
  with no fetch); keys that already exist merge after commit.
- `cache.update` (and `optimistic:` updaters) now decode the written value
  through the procedure's output codec, so an entity inserted into an empty
  cache slot is branded and reachable by `cache.updateEntity` and mutation
  write-through — previously this depended on the removed observe-time
  re-decode.

- Cached values are normalized by encoding and then decoding through the output
  codec. Hydration previously decoded the cached application value as if it were
  wire data, which silently corrupted outputs using a transforming `wire.codec`
  whose application and wire types overlap, and dropped the hydrated entry when
  they did not.

No API changes.

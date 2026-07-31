# result-rpc

## 0.2.0

### Minor Changes

- 290ee5e: **Breaking: `mutate()` no longer returns a `Result`.** It returns `void` and never rejects. The awaiting form is now `mutateAsync(input)`, which returns `Promise<Result<…>>` and rejects with the `cancelled` and `claimed` control signals as `mutate` used to.

  This is the split TanStack Query established, and it exists because the old single call could not be both. A fire-and-forget call site has nowhere to put a rejection: our own documented `onChange={(e) => void assign.mutate({ … })}` was an unhandled rejection the moment any mounted shell claimed the failure, and was correct only in an app where nothing claimed.

  To migrate: **add `Async` wherever you awaited the result.** Call sites that did not await — including any that carried a `.catch(() => undefined)` to swallow control signals — can drop the incantation and stay on `mutate`.

  ```diff
  - const result = await rename.mutate({ id, title });
  + const result = await rename.mutateAsync({ id, title });

  - void assign.mutate({ issueId, assigneeId }).catch(() => undefined);
  + assign.mutate({ issueId, assigneeId });
  ```

- 290ee5e: **Added `wire.nullable(codec)`**, the union that was being written by hand. It builds `wire.union([codec, wire.null])`, so the encoding and the contract digest are unchanged.

### Patch Changes

- 290ee5e: **A declared domain failure now dehydrates and hydrates.** An RSC prefetch of a row that does not exist renders its `not-found` state on first paint at zero client requests, instead of server-rendering an empty body and only answering after a round trip. The failure comes back reified through the procedure's error registry, so it narrows, matches, and is claimed by shells exactly as a live one is.

  Framework and transport failures (`client/*`, `server/*`) are still excluded: they describe one attempt on one machine, and baking one in would replace a fetch the browser can retry with a verdict it cannot.

- 290ee5e: **`$satisfies` no longer fails on `readonly`.** Model types are compared modulo `readonly`, so a codec decoding to `readonly string[]` matches a source column typed `string[]`. Wire codecs decode readonly by design, so this fired on correctly-aligned schemas — a false positive.

  Nullability strictness is unchanged: `string` against `string | null` is still a mismatch. The diagnostic now names every offending field and prints both sides as literal text rather than as a structural type the compiler would collapse to an alias name. It appears directly on the bare `.$satisfies<Source>()` call; no hover or deliberately wrong argument is needed to reveal it.

  In a project compiled without `strictNullChecks`, the message is now readable rather than TS2589 ("Type instantiation is excessively deep and possibly infinite"), and it says outright that nullability was not compared — because without that flag the compiler cannot tell a nullable column from a non-nullable one, and that is most of what this assertion exists to check.

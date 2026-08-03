# result-rpc

## 0.3.0

### Minor Changes

- b8ddbf2: **Rearchitect on better-result 3.0.** result-rpc de-vendors its Result algebra
  and depends on `better-result@^3.0.0`: `Ok`/`Err` class instances, upstream
  composition, `Result.codec`, generator behavior, and Panic semantics are all
  better-result's. result-rpc owns the RPC boundary rule — only declared,
  serializable, reifiable tagged errors may enter or leave a procedure.

  Breaking changes:

  - **Results are better-result instances with a `status` discriminant.** The
    `.ok` boolean property and frozen plain objects are gone. Discriminate with
    `result.status === "ok"` / `"error"` or the narrowing `isOk()` / `isErr()`.
  - **The public Result type constrains the error channel:**
    `Result<T, E extends AnyTaggedError>`. `Result<T, string>` fails statically
    and at the runtime boundary.
  - **`gen` follows better-result:** bodies return a Result (`return ok(x)`).
  - **`all` is tuple-only** (better-result's `Result.all`).
  - **Renames / removals:** `orElse` → `tryRecover`; `getOrElse` →
    `unwrapOr` (value fallback) or `match`; `tryCatch`/`tryPromise` →
    `Result.try`/`Result.tryPromise` with the `{ try, catch }` form.
  - **Protocol v2:** the response envelope is
    `{ status: "ok" | "error", ... }` (was `{ ok: boolean }`); content types
    move to `sv=2`.
  - **Per-procedure Result codec:** handler Results are validated and
    reconstructed through `Result.codec` + Standard Schema adapters around the
    output wire codec and the declared error registry. Counterfeit, foreign,
    private, and malformed errors are sanitized framework failures, never
    domain errors.
  - **Panic semantics:** a Result callback that throws becomes a better-result
    `Panic` — sanitized to `server/internal` at the boundary; the cause reaches
    server-side observability, never the wire.

  Adoption: a better-result Result whose error is already a result-rpc tagged
  error flows into a procedure handler unchanged (zero-copy). A foreign error is
  folded with `mapError` before the boundary. Migration notes in the docs'
  [Result composition](/concepts/results/) page.

- 9fefd38: Add `wire.enum(["open", "closed"])` for non-empty string literal unions. It
  infers the literal union without `as const` and preserves the contract identity
  of the equivalent `wire.union` of `wire.literal` codecs.

### Patch Changes

- b19d4e7: Make the bundled coding-agent skill discoverable from npm and the docs, and
  route new integrations through client-boundary, external-I/O, type-inference,
  rich-wire-value, and query-freshness guidance before code is written.

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

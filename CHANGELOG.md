# result-rpc

## 0.3.0

### Minor Changes

- b8ddbf2: **Rearchitect on better-result 3.0 (breaking).** result-rpc de-vendors its
  Result algebra. `better-result@^3.0.0` is now a **peer dependency** — one
  shared `Ok`/`Err` class across your app, because the boundary validates
  handler returns with `instanceof` and zero-copy adoption requires the Result
  you construct to be the class result-rpc checks. `Ok`/`Err` class instances,
  composition, `Result.codec`, generator behavior, and Panic semantics are all
  better-result's. result-rpc owns the RPC boundary rule — only declared,
  serializable, reifiable tagged errors may enter or leave a procedure.

  **Breaking changes**

  - **Results are better-result instances with a `status` discriminant.** The
    `.ok` boolean property and frozen plain objects are gone.

    ```diff
    - if (result.ok) return result.value;
    - if (!result.ok) return result.error.data.id;
    + if (result.status === "ok") return result.value;
    + if (result.isErr()) return result.error.data.id; // isOk()/isErr() narrow
    ```

  - **The public Result type constrains the error channel:**
    `Result<T, E extends AnyTaggedError>`. `Result<T, string>` fails statically
    and at the runtime boundary. Framework-internal paths still use
    `Result<unknown, AnyTaggedError>`.
  - **`gen` follows better-result:** bodies return a Result (`return ok(x)`);
    `return yield* err(x)` fails a block explicitly. `GenErr` is re-exported.
    (A value-return `gen` was trialed after one smoke test and reverted: it
    re-vendored the generator loop, split the calling convention from
    upstream, and made `return ok(x)` silently double-wrap — the wrong-line
    diagnostic it fixed was transition friction, not steady-state DX.)
  - **`all` is tuple-only** (better-result's `Result.all`); the record form is
    gone — compose with `all([...])` + `map` instead.
  - **`tryCatch` / `tryPromise` are passthroughs of `Result.try` /
    `Result.tryPromise`** (the `{ try, catch }` options form) — importable
    from result-rpc, so the throwing boundary needs no second import from
    better-result.
  - **Renames / removals:**
    - `orElse` → `tryRecover`
    - `getOrElse` → `unwrapOr` (value fallback) or `match` (error-aware fallback)
    - type exports `AllValues`, `AllErrors`, `ErrorHandlers` removed (upstream
      types replace them); `InferErr` / `InferOk` are newly exported for
      spelling a procedure's error channel / success value
  - **Breaking wire format (pre-1.0, no protocol version bump):** the response
    envelope is `{ status: "ok" | "error", ... }` (was `{ ok: boolean }`).
    result-rpc ships both sides of the wire and has no external clients, so
    before 1.0 a breaking protocol change is just a breaking change —
    `PROTOCOL_VERSION` stays 1 and content types stay `sv=1`. Client and server
    update together.
  - **Per-procedure Result codec:** handler Results are validated and
    reconstructed through `Result.codec` + Standard Schema adapters around the
    output wire codec and the declared error registry. Counterfeit, foreign,
    private, and malformed errors are sanitized framework failures, never
    domain errors.
  - **Panic semantics:** a Result callback that throws becomes a better-result
    `Panic` — sanitized to `server/internal` at the boundary; the cause reaches
    server-side observability, never the wire.

  **Adopting upstream better-result results**

  A better-result Result whose error is already a result-rpc tagged error flows
  into a procedure handler unchanged (zero-copy) — declare the error in
  `.errors({ ... })` and return it. A foreign error folds in one explicit step
  before the boundary:

  ```ts
  const result = await repository.findUser(id);
  return result.mapError((cause) =>
    RepositoryUnavailable({ operation: "findUser", causeName: cause.name }),
  );
  ```

  There is deliberately no `adoptResult` helper — the constrained `Result` type
  plus `mapError` is the whole workflow.

  **Migration checklist**

  1. Install `better-result@^3.0.0` alongside (npm ≥ 7 / pnpm install it as
     the peer automatically).
  2. Replace `.ok` with `status === "ok"` / `isOk()` / `isErr()`.
  3. In `gen` bodies, return `ok(...)` (or `return yield* err(...)` to fail).
  4. Replace `orElse` → `tryRecover`, `getOrElse` → `unwrapOr` or `match`.
     `tryCatch` / `tryPromise` are passthroughs — same `{ try, catch }` call
     shape as better-result's `Result.try` / `Result.tryPromise`.
  5. Rebuild the client (the wire envelope shape changed; old clients and new
     servers are mutually `client/protocol-violation` / `server/bad-request`).

  Migration notes and worked examples: the docs'
  [Result composition](/concepts/results/) page and
  [FAQ](/reference/faq).

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

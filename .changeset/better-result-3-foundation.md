---
"result-rpc": major
---

**Rearchitect on better-result 3.0.** result-rpc de-vendors its Result algebra
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

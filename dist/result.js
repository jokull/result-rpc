import { Result } from "better-result";
//#region src/result.ts
/**
* result-rpc's constrained Result vocabulary over better-result@3.
*
* Better Result owns the Ok/Err runtime, the composition algebra, the
* generator, panic semantics, and Result.codec. result-rpc owns the RPC
* boundary rule: only declared, serializable, reifiable tagged errors may
* enter or leave a procedure. That rule is spelled here as the constrained
* `Result<T, E extends AnyTaggedError>` type and the `ok`/`err` constructors
* pinned to it — the boundary's own code and handlers build Results through
* them, so a foreign error lane is rejected at construction, not later.
*
* The algebra (`gen`, `map`, `mapError`, `andThen`, `match`, `matchError`,
* `tap`, `tapError`, `tapBoth`, `all`, `tryRecover`, `unwrap`, `unwrapOr`,
* `tryCatch`, `tryPromise`, `isOk`, `isErr`) is better-result's and lives
* there, imported where it belongs:
*
*   import { Result, matchError } from "better-result";    // the algebra
*   import { ok, err, server, contract, defineErrors } from "result-rpc";
*
* Handlers fold foreign error lanes into declared, result-rpc-compatible tags
* themselves — `err(declaredTag)` — before returning; the `.handler()` return
* type is the compiler-checked enforcement, not a re-export.
*
* Breaking changes vs the 0.3 `result.ts`:
* - The algebra is no longer re-exported. Use `Result.gen`, `Result.map`,
*   `Result.try`, ... and `matchError` from better-result directly
*   (better-result's guard static is `Result.isError`, not `isErr`).
* - `ok`/`err` stay: they are result-rpc's constrained constructors.
*/
const ok = (value) => Result.ok(value);
const err = (error) => Result.err(error);
//#endregion
export { err, ok };

//# sourceMappingURL=result.js.map
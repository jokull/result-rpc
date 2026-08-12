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
import { Result as BetterResult, type InferErr as BetterInferErr, type InferOk as BetterInferOk, type Ok as BetterOk, type Err as BetterErr } from "better-result";
import type { AnyTaggedError } from "./error.js";
export type Result<T, E extends AnyTaggedError> = BetterResult<T, E>;
export type Ok<T, E extends AnyTaggedError = never> = BetterOk<T, E>;
export type Err<E extends AnyTaggedError> = BetterErr<never, E>;
/** The error channel of a Result — first-class spelling for procedure types. */
export type InferErr<R> = BetterInferErr<R>;
/** The success value of a Result. */
export type InferOk<R> = BetterInferOk<R>;
/** The union of errors a `gen` body yields — better-result's generator contract. */
export type GenErr<TYield> = TYield extends Err<infer E> ? E : never;
export declare const ok: <T>(value: T) => Result<T, never>;
export declare const err: <E extends AnyTaggedError>(error: E) => Result<never, E>;

/**
 * result-rpc's constrained Result surface over better-result@3.
 *
 * Better Result owns the general-purpose Ok/Err runtime, composition,
 * generator behavior, panic semantics, and Result.codec. result-rpc owns the
 * RPC boundary rule: only declared, serializable, reifiable tagged errors may
 * enter or leave a procedure. The public `Result<T, E>` type therefore
 * constrains `E` to result-rpc tagged errors; every combinator re-exported
 * below is better-result's, unchanged.
 *
 * Breaking changes vs the 0.2 `result.ts`:
 * - Results are better-result `Ok`/`Err` class instances with a
 *   `status: "ok" | "error"` discriminant (`result.ok` is gone — use
 *   `result.status === "ok"` or `result.isOk()`).
 * - `gen` bodies must return a Result (`return ok(value)`), matching
 *   better-result's `Result.gen`.
 * - `all` is tuple-only; record shapes are folded with `Result.all` + map.
 * - `orElse` → `tryRecover`, `getOrElse` → `unwrapOr` (value fallback) or
 *   `match`.
 * - `tryCatch`/`tryPromise` are removed — use `Result.try`/`Result.tryPromise`
 *   with the `{ try, catch }` form; the catch handler returns a Result, so
 *   foreign causes are folded to declared tagged errors there.
 */
import {
  Result as BetterResult,
  matchError as betterMatchError,
  type Ok as BetterOk,
  type Err as BetterErr,
} from "better-result";
import type { AnyTaggedError } from "./error.js";

export type Result<T, E extends AnyTaggedError> = BetterResult<T, E>;
export type Ok<T, E extends AnyTaggedError = never> = BetterOk<T, E>;
export type Err<E extends AnyTaggedError> = BetterErr<never, E>;

export const ok = <T>(value: T): Result<T, never> => BetterResult.ok(value);

export const err = <E extends AnyTaggedError>(error: E): Result<never, E> =>
  BetterResult.err(error);

export const isOk = <T, E extends AnyTaggedError>(result: Result<T, E>): result is Ok<T, E> =>
  result.isOk();

export const isErr = <T, E extends AnyTaggedError>(result: Result<T, E>): result is Err<E> =>
  result.isErr();

// Composition, matching, tap, generator, and defect semantics are
// better-result's — re-exported unchanged, never reimplemented.
export const map = BetterResult.map;
export const mapError = BetterResult.mapError;
export const andThen = BetterResult.andThen;
export const match = BetterResult.match;
export const matchError = betterMatchError;
export const tap = BetterResult.tap;
export const tapError = BetterResult.tapError;
export const tapBoth = BetterResult.tapBoth;
export const all = BetterResult.all;
export const gen = BetterResult.gen;
export const tryRecover = BetterResult.tryRecover;
export const unwrap = BetterResult.unwrap;
export const unwrapOr = BetterResult.unwrapOr;

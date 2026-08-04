/**
 * result-rpc's constrained Result surface over better-result@3.
 *
 * Better Result owns the general-purpose Ok/Err runtime, composition,
 * generator behavior, panic semantics, and Result.codec. result-rpc owns the
 * RPC boundary rule: only declared, serializable, reifiable tagged errors may
 * enter or leave a procedure. The public `Result<T, E>` type therefore
 * constrains `E` to result-rpc tagged errors.
 *
 * Everything — composition, matching, tap, recovery, the generator, the
 * codec, Panic — is better-result's, re-exported unchanged, never
 * reimplemented. `gen` follows better-result's convention (bodies return a
 * Result, `return ok(value)`); `tryCatch`/`tryPromise` are passthroughs of
 * `Result.try`/`Result.tryPromise` so the throwing boundary never needs a
 * second import.
 *
 * Breaking changes vs the 0.2 `result.ts`:
 * - Results are better-result `Ok`/`Err` class instances with a
 *   `status: "ok" | "error"` discriminant (`result.ok` is gone — use
 *   `result.status === "ok"` or `result.isOk()`).
 * - `all` is tuple-only; record shapes are folded with `Result.all` + map.
 * - `orElse` → `tryRecover`, `getOrElse` → `unwrapOr` (value fallback) or
 *   `match`.
 */
import {
  Result as BetterResult,
  matchError as betterMatchError,
  type InferErr as BetterInferErr,
  type InferOk as BetterInferOk,
  type Ok as BetterOk,
  type Err as BetterErr,
} from "better-result";
import type { AnyTaggedError } from "./error.js";

export type Result<T, E extends AnyTaggedError> = BetterResult<T, E>;
export type Ok<T, E extends AnyTaggedError = never> = BetterOk<T, E>;
export type Err<E extends AnyTaggedError> = BetterErr<never, E>;
/** The error channel of a Result — first-class spelling for procedure types. */
export type InferErr<R> = BetterInferErr<R>;
/** The success value of a Result. */
export type InferOk<R> = BetterInferOk<R>;

export const ok = <T>(value: T): Result<T, never> => BetterResult.ok(value);

export const err = <E extends AnyTaggedError>(error: E): Result<never, E> =>
  BetterResult.err(error);

export const isOk = <T, E extends AnyTaggedError>(result: Result<T, E>): result is Ok<T, E> =>
  result.isOk();

export const isErr = <T, E extends AnyTaggedError>(result: Result<T, E>): result is Err<E> =>
  result.isErr();

// Composition, matching, tap, recovery, and unwrapping are better-result's —
// re-exported unchanged, never reimplemented.
export const map = BetterResult.map;
export const mapError = BetterResult.mapError;
export const andThen = BetterResult.andThen;
export const match = BetterResult.match;
export const matchError = betterMatchError;
export const tap = BetterResult.tap;
export const tapError = BetterResult.tapError;
export const tapBoth = BetterResult.tapBoth;
export const all = BetterResult.all;
export const tryRecover = BetterResult.tryRecover;
export const unwrap = BetterResult.unwrap;
export const unwrapOr = BetterResult.unwrapOr;

export type GenErr<TYield> = TYield extends Err<infer E> ? E : never;

export const gen = BetterResult.gen;
export const tryCatch = BetterResult.try;
export const tryPromise = BetterResult.tryPromise;

/**
 * result-rpc's constrained Result surface over better-result@3.
 *
 * Better Result owns the general-purpose Ok/Err runtime, composition,
 * generator behavior, panic semantics, and Result.codec. result-rpc owns the
 * RPC boundary rule: only declared, serializable, reifiable tagged errors may
 * enter or leave a procedure. The public `Result<T, E>` type therefore
 * constrains `E` to result-rpc tagged errors.
 *
 * Two calling conventions are deliberately result-rpc's own, implemented as
 * thin wrappers over better-result (smoke-tested against a real migration):
 *
 * - **`gen` returns values.** A gen body returns the success value directly
 *   (`return value`); `return yield* err(x)` fails a block explicitly; `yield*`
 *   unwraps or short-circuits. There is exactly one spelling of success and
 *   one of failure. (Better-result's own `Result.gen` keeps its
 *   `return ok(x)` convention for upstream users.)
 * - **`tryCatch`/`tryPromise` take `(fn, onThrow)`.** The throwing boundary is
 *   adopted behind a tagged error in one call — no `{ try, catch }` object
 *   literal with keyword keys, no second import.
 *
 * Everything else — composition, matching, tap, recovery, codec, Panic — is
 * better-result's, re-exported unchanged, never reimplemented.
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
import { closeIterator } from "./iterator.js";
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

type ResultGenerator =
  | Generator<Err<AnyTaggedError>, unknown>
  | AsyncGenerator<Err<AnyTaggedError>, unknown>;

const isAsyncResultGenerator = (
  iterator: ResultGenerator,
): iterator is AsyncGenerator<Err<AnyTaggedError>, unknown> => Symbol.asyncIterator in iterator;

/**
 * Generator composition in result-rpc's calling convention: `yield*` a Result
 * to unwrap its value or short-circuit the whole block on its first Err; the
 * body **returns the success value directly**; `return yield* err(...)` (or
 * `return yield* SomeTaggedError(...)`) fails the block explicitly. The
 * failure union accumulates from everything yielded.
 *
 * ```ts
 * const outcome = gen(function* () {
 *   const doc = yield* findDoc(id);   // Result<Doc, DocNotFound>
 *   const body = yield* parseBody(doc); // Result<Body, ParseFailure>
 *   return render(doc, body);         // the value, not ok(value)
 * });
 * // Result<Rendered, DocNotFound | ParseFailure>
 * ```
 *
 * Pass an async generator to compose awaited Results the same way; the return
 * type becomes a Promise. `finally` blocks run even when an Err
 * short-circuits. Implemented over better-result Results — the `ok`/`err`
 * factories and every yielded Err are better-result instances.
 */
export function gen<TYield extends Err<AnyTaggedError>, TReturn>(
  body: () => Generator<TYield, TReturn>,
): Result<TReturn, GenErr<TYield>>;
export function gen<TYield extends Err<AnyTaggedError>, TReturn>(
  body: () => AsyncGenerator<TYield, TReturn>,
): Promise<Result<TReturn, GenErr<TYield>>>;
export function gen(
  body: () => ResultGenerator,
): Result<unknown, AnyTaggedError> | Promise<Result<unknown, AnyTaggedError>> {
  const iterator = body();
  if (isAsyncResultGenerator(iterator)) {
    return (async () => {
      const step = await iterator.next();
      if (!step.done) {
        await closeIterator(iterator);
        return step.value;
      }
      return ok(step.value);
    })();
  }
  const step = iterator.next();
  if (!step.done) {
    // A sync generator whose `finally` throws would otherwise escape this
    // synchronous path as an unhandled rejection — the block already resolved
    // to its `Err`, so a cleanup failure has nowhere legitimate to surface.
    void closeIterator(iterator).catch(() => undefined);
    return step.value;
  }
  return ok(step.value);
}

/**
 * Adopt a throwing function behind a tagged error in one call: the catch
 * handler must produce a declared TaggedError — an arbitrary upstream Error
 * never enters the recoverable failure channel as itself.
 */
export const tryCatch = <T, E extends AnyTaggedError>(
  fn: () => T,
  onThrow: (cause: unknown) => E,
): Result<T, E> => {
  try {
    return ok(fn());
  } catch (cause) {
    return err(onThrow(cause));
  }
};

/** {@link tryCatch} for async work: catches both sync throws and rejections. */
export const tryPromise = <T, E extends AnyTaggedError>(
  fn: () => PromiseLike<T> | T,
  onThrow: (cause: unknown) => E,
): Promise<Result<T, E>> =>
  (async () => {
    try {
      return ok(await fn());
    } catch (cause) {
      return err(onThrow(cause));
    }
  })();

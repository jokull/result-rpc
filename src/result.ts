import type { AnyTaggedError } from "./error.js";

export type Ok<T> = Readonly<{ ok: true; value: T }>;
export type Err<E extends AnyTaggedError> = Readonly<{ ok: false; error: E }>;
export type Result<T, E extends AnyTaggedError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => Object.freeze({ ok: true, value });

export const err = <E extends AnyTaggedError>(error: E): Err<E> =>
  Object.freeze({ ok: false, error });

export const isOk = <T, E extends AnyTaggedError>(
  result: Result<T, E>,
): result is Ok<T> => result.ok;

export const isErr = <T, E extends AnyTaggedError>(
  result: Result<T, E>,
): result is Err<E> => !result.ok;

export const map = <A, B, E extends AnyTaggedError>(
  result: Result<A, E>,
  fn: (value: A) => B,
): Result<B, E> => result.ok ? ok(fn(result.value)) : result;

export const andThen = <
  A,
  B,
  E1 extends AnyTaggedError,
  E2 extends AnyTaggedError,
>(
  result: Result<A, E1>,
  fn: (value: A) => Result<B, E2>,
): Result<B, E1 | E2> => result.ok ? fn(result.value) : result;

export const mapError = <
  A,
  E1 extends AnyTaggedError,
  E2 extends AnyTaggedError,
>(
  result: Result<A, E1>,
  fn: (error: E1) => E2,
): Result<A, E2> => result.ok ? result : err(fn(result.error));

export const match = <T, E extends AnyTaggedError, R1, R2>(
  result: Result<T, E>,
  handlers: Readonly<{
    ok: (value: T) => R1;
    error: (error: E) => R2;
  }>,
): R1 | R2 => result.ok
  ? handlers.ok(result.value)
  : handlers.error(result.error);

type ErrorHandlers<E extends AnyTaggedError, R> = {
  readonly [Tag in E["_tag"]]: (
    error: Extract<E, { readonly _tag: Tag }>,
  ) => R;
};

export const matchError = <E extends AnyTaggedError, R>(
  error: E,
  handlers: ErrorHandlers<E, R>,
): R => {
  const handler = handlers[error._tag as E["_tag"]];
  return handler(error as Extract<E, { readonly _tag: E["_tag"] }>);
};

/**
 * Observation combinators (better-result parity): run a side effect, return
 * the original Result unchanged. A tap must never alter control flow — a
 * throwing tap is a defect in the tap, not a new failure channel, so it
 * propagates as an exception rather than becoming an Err.
 */
export const tap = <T, E extends AnyTaggedError>(
  result: Result<T, E>,
  fn: (value: T) => void,
): Result<T, E> => {
  if (result.ok) fn(result.value);
  return result;
};

export const tapError = <T, E extends AnyTaggedError>(
  result: Result<T, E>,
  fn: (error: E) => void,
): Result<T, E> => {
  if (!result.ok) fn(result.error);
  return result;
};

export const tapBoth = <T, E extends AnyTaggedError>(
  result: Result<T, E>,
  handlers: Readonly<{
    ok: (value: T) => void;
    error: (error: E) => void;
  }>,
): Result<T, E> => {
  if (result.ok) handlers.ok(result.value);
  else handlers.error(result.error);
  return result;
};

import type { AnyTaggedError } from "./error.js";

/**
 * Results are frozen result-rpc runtime values. Their enumerable shape stays
 * small and transparent, while a non-enumerable `Symbol.iterator` makes
 * `yield*` work directly inside `gen`. RPC decoding reconstructs this runtime
 * behavior; naive serialization does not. The composition surface below ports
 * the core DX of better-result and neverthrow — with two deliberate
 * divergences: the error channel requires tagged errors (`_tag` + wire-safe
 * `data`), and there is no serialization helper because serialization is the
 * library's own first-class concern.
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
  /** Enables `yield*` in {@link gen}: yields nothing, evaluates to the value. */
  [Symbol.iterator](): Iterator<never, T>;
}

export interface Err<E extends AnyTaggedError> {
  readonly ok: false;
  readonly error: E;
  /** Enables `yield*` in {@link gen}: yields the Err once, never resumes. */
  [Symbol.iterator](): Iterator<Err<E>, never>;
}

export type Result<T, E extends AnyTaggedError> = Ok<T> | Err<E>;

function resultIterator(this: Result<unknown, AnyTaggedError>) {
  let done = false;
  return {
    next: (): IteratorResult<unknown> => {
      if (done) return { done: true, value: undefined };
      done = true;
      return this.ok ? { done: true, value: this.value } : { done: false, value: this };
    },
  };
}

const withIterator = <T extends object>(result: T): T =>
  Object.freeze(
    Object.defineProperty(result, Symbol.iterator, {
      value: resultIterator,
      enumerable: false,
    }),
  );

export const ok = <T>(value: T): Ok<T> => withIterator({ ok: true, value }) as Ok<T>;

export const err = <E extends AnyTaggedError>(error: E): Err<E> =>
  withIterator({ ok: false, error }) as Err<E>;

export const isOk = <T, E extends AnyTaggedError>(result: Result<T, E>): result is Ok<T> =>
  result.ok;

export const isErr = <T, E extends AnyTaggedError>(result: Result<T, E>): result is Err<E> =>
  !result.ok;

export const map = <A, B, E extends AnyTaggedError>(
  result: Result<A, E>,
  fn: (value: A) => B,
): Result<B, E> => (result.ok ? ok(fn(result.value)) : result);

export const andThen = <A, B, E1 extends AnyTaggedError, E2 extends AnyTaggedError>(
  result: Result<A, E1>,
  fn: (value: A) => Result<B, E2>,
): Result<B, E1 | E2> => (result.ok ? fn(result.value) : result);

export const mapError = <A, E1 extends AnyTaggedError, E2 extends AnyTaggedError>(
  result: Result<A, E1>,
  fn: (error: E1) => E2,
): Result<A, E2> => (result.ok ? result : err(fn(result.error)));

export const match = <T, E extends AnyTaggedError, R1, R2>(
  result: Result<T, E>,
  handlers: Readonly<{
    ok: (value: T) => R1;
    error: (error: E) => R2;
  }>,
): R1 | R2 => (result.ok ? handlers.ok(result.value) : handlers.error(result.error));

type ErrorHandlers<E extends AnyTaggedError, R> = {
  readonly [Tag in E["_tag"]]: (error: Extract<E, { readonly _tag: Tag }>) => R;
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

/** Recover from a failure with a new Result; a success passes through. */
export const orElse = <T, T2, E1 extends AnyTaggedError, E2 extends AnyTaggedError>(
  result: Result<T, E1>,
  fn: (error: E1) => Result<T2, E2>,
): Result<T | T2, E2> => (result.ok ? result : fn(result.error));

/** Unwrap the value or compute a fallback from the error. */
export const getOrElse = <T, T2, E extends AnyTaggedError>(
  result: Result<T, E>,
  fallback: (error: E) => T2,
): T | T2 => (result.ok ? result.value : fallback(result.error));

/**
 * Adopt a throwing function into the Result world. The catch handler must
 * produce a declared TaggedError — an arbitrary upstream Error never enters
 * the recoverable failure channel as itself.
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
export const tryPromise = async <T, E extends AnyTaggedError>(
  fn: () => PromiseLike<T>,
  onThrow: (cause: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(onThrow(cause));
  }
};

type AllValues<TShape> = {
  -readonly [K in keyof TShape]: TShape[K] extends Result<infer T, AnyTaggedError> ? T : never;
};
type AllErrors<TShape> = (
  TShape extends readonly unknown[] ? TShape[number] : TShape[keyof TShape]
) extends infer TMember
  ? TMember extends Err<infer E>
    ? E
    : never
  : never;

/**
 * Combine a tuple or record of Results: all successes, or the first failure
 * encountered (tuple order / key insertion order).
 */
export function all<const TResults extends readonly Result<unknown, AnyTaggedError>[]>(
  results: TResults,
): Result<AllValues<TResults>, AllErrors<TResults>>;
export function all<
  const TResults extends Readonly<Record<string, Result<unknown, AnyTaggedError>>>,
>(results: TResults): Result<AllValues<TResults>, AllErrors<TResults>>;
export function all(
  results:
    | readonly Result<unknown, AnyTaggedError>[]
    | Readonly<Record<string, Result<unknown, AnyTaggedError>>>,
): Result<unknown, AnyTaggedError> {
  if (Array.isArray(results)) {
    const values: unknown[] = [];
    for (const result of results) {
      if (!result.ok) return result;
      values.push(result.value);
    }
    return ok(values);
  }
  const values: Record<string, unknown> = {};
  for (const [key, result] of Object.entries(results)) {
    if (!result.ok) return result;
    values[key] = result.value;
  }
  return ok(values);
}

type GenErr<TYield> = TYield extends Err<infer E> ? E : never;

/**
 * Generator composition (the core DX of better-result, ported with credit):
 * `yield*` a Result to unwrap its value or short-circuit on its first Err.
 * The failure union accumulates automatically from everything yielded.
 *
 * ```ts
 * const outcome = gen(function* () {
 *   const doc = yield* findDoc(id)        // Result<Doc, DocNotFound>
 *   const body = yield* parseBody(doc)    // Result<Body, ParseFailure>
 *   return render(doc, body)
 * })
 * // Result<Rendered, DocNotFound | ParseFailure>
 * ```
 *
 * Pass an async generator to compose awaited Results the same way; the
 * return type becomes a Promise. `finally` blocks in the generator run even
 * when an Err short-circuits.
 */
export function gen<TYield extends Err<AnyTaggedError>, TReturn>(
  body: () => Generator<TYield, TReturn>,
): Result<TReturn, GenErr<TYield>>;
export function gen<TYield extends Err<AnyTaggedError>, TReturn>(
  body: () => AsyncGenerator<TYield, TReturn>,
): Promise<Result<TReturn, GenErr<TYield>>>;
export function gen(
  body: () =>
    | Generator<Err<AnyTaggedError>, unknown>
    | AsyncGenerator<Err<AnyTaggedError>, unknown>,
): Result<unknown, AnyTaggedError> | Promise<Result<unknown, AnyTaggedError>> {
  const iterator = body();
  if (Symbol.asyncIterator in iterator) {
    const asyncIterator = iterator as AsyncGenerator<Err<AnyTaggedError>, unknown>;
    return (async () => {
      const step = await asyncIterator.next();
      if (!step.done) {
        await asyncIterator.return(undefined as never);
        return step.value;
      }
      return ok(step.value);
    })();
  }
  const syncIterator = iterator as Generator<Err<AnyTaggedError>, unknown>;
  const step = syncIterator.next();
  if (!step.done) {
    syncIterator.return(undefined as never);
    return step.value;
  }
  return ok(step.value);
}

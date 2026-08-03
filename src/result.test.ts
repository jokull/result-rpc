import { describe, expect, test } from "bun:test";
import { error, wire } from "./index.js";
import {
  all,
  err,
  gen,
  matchError,
  ok,
  tryCatch,
  tryPromise,
  tryRecover,
  unwrapOr,
  type Result,
} from "./result.js";

const NotFound = error({
  tag: "thing/not-found",
  data: wire.object({ id: wire.string }),
  httpStatus: 404,
});
const ParseFailure = error({
  tag: "thing/parse-failure",
  data: wire.object({ reason: wire.string }),
  httpStatus: 422,
});

type NotFoundError = ReturnType<typeof NotFound>;
type ParseError = ReturnType<typeof ParseFailure>;

const find = (id: string): Result<string, NotFoundError> =>
  id === "missing" ? err(NotFound({ id })) : ok(`doc:${id}`);

const parse = (raw: string): Result<number, ParseError> =>
  raw.includes("bad") ? err(ParseFailure({ reason: raw })) : ok(raw.length);

describe("result runtime", () => {
  test("Results are better-result Ok/Err instances with a status discriminant", () => {
    const success = ok({ id: "one" });
    expect(success.status).toBe("ok");
    expect(success.isOk()).toBe(true);
    expect(Object.keys(success)).toEqual(["status", "value"]);
    expect(JSON.stringify(success)).toBe('{"status":"ok","value":{"id":"one"}}');
    // Instances are not frozen plain objects anymore — the boundary rule is
    // the codec's, not Object.freeze's.
    expect(Object.isFrozen(success)).toBe(false);
    const failure = err(NotFound({ id: "one" }));
    expect(failure.status).toBe("error");
    expect(failure.isErr()).toBe(true);
    if (failure.isErr()) expect(NotFound.is(failure.error)).toBe(true);
  });

  test("gen unwraps yielded successes and returns ok", () => {
    const outcome = gen(function* () {
      const doc = yield* find("one");
      const size = yield* parse(doc);
      return ok(`${doc}/${size}`);
    });
    expect(outcome).toEqual(ok("doc:one/7"));
  });

  test("gen short-circuits on the first Err and runs finally blocks", () => {
    let cleaned = false;
    const outcome = gen(function* () {
      try {
        const doc = yield* find("missing");
        return parse(doc);
      } finally {
        cleaned = true;
      }
    });
    expect(outcome).toEqual(err(NotFound({ id: "missing" })));
    expect(cleaned).toBe(true);
  });

  test("yield* err() fails a gen body explicitly", () => {
    const outcome = gen(function* () {
      if (true as boolean) return yield* err(ParseFailure({ reason: "manual" }));
      return ok(1);
    });
    expect(outcome).toEqual(err(ParseFailure({ reason: "manual" })));
  });

  test("yield* TaggedError fails a gen body directly", () => {
    const failure = NotFound({ id: "missing" });
    const outcome = gen(function* () {
      return yield* failure;
    });
    expect(outcome).toEqual(err(failure));
  });

  test("gen composes awaited Results through an async generator", async () => {
    const fetchDoc = async (id: string) => find(id);
    const outcome = await gen(async function* () {
      const doc = yield* await fetchDoc("one");
      const size = yield* parse(doc);
      return ok(size * 2);
    });
    expect(outcome).toEqual(ok(14));
    const failure = await gen(async function* () {
      const doc = yield* await fetchDoc("missing");
      return ok(doc);
    });
    expect(failure).toEqual(err(NotFound({ id: "missing" })));
  });

  test("tryCatch passthrough adopts a throwing function behind a tagged error", () => {
    const good = tryCatch({
      try: () => JSON.parse('{"a":1}') as { a: number },
      catch: (cause) => ParseFailure({ reason: String(cause) }),
    });
    expect(good).toEqual(ok({ a: 1 }));
    const bad = tryCatch({
      try: () => JSON.parse("nope") as never,
      catch: () => ParseFailure({ reason: "invalid json" }),
    });
    expect(bad).toEqual(err(ParseFailure({ reason: "invalid json" })));
  });

  test("tryPromise catches rejections and sync throws", async () => {
    const rejected = await tryPromise({
      try: () => Promise.reject(new Error("boom")),
      catch: () => ParseFailure({ reason: "rejected" }),
    });
    expect(rejected).toEqual(err(ParseFailure({ reason: "rejected" })));
    const thrown = await tryPromise({
      try: () => {
        throw new Error("early");
      },
      catch: () => ParseFailure({ reason: "threw" }),
    });
    expect(thrown).toEqual(err(ParseFailure({ reason: "threw" })));
    const good = await tryPromise({
      try: async () => 3,
      catch: () => ParseFailure({ reason: "" }),
    });
    expect(good).toEqual(ok(3));
  });

  test("all combines tuples, first failure wins", () => {
    expect(all([find("a"), parse("xy")])).toEqual(ok(["doc:a", 2]));
    expect(all([find("missing"), parse("bad")])).toEqual(err(NotFound({ id: "missing" })));
  });

  test("tryRecover recovers a failure; unwrapOr unwraps with a fallback value", () => {
    const recovered = tryRecover(find("missing"), () => ok("doc:fallback"));
    expect(recovered).toEqual(ok("doc:fallback"));
    expect(unwrapOr(find("missing"), "doc:fallback")).toBe("doc:fallback");
    expect(unwrapOr(find("one"), "unused")).toBe("doc:one");
    const failure = err(ParseFailure({ reason: "bad" }));
    if (!failure.isErr()) throw new Error("expected err");
    const message = matchError(failure.error, {
      "thing/parse-failure": (failure) => failure.data.reason,
    });
    expect(message).toBe("bad");
  });
});

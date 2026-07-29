import { describe, expect, test } from "bun:test";
import { error, wire } from "./index.js";
import {
  all,
  err,
  gen,
  getOrElse,
  ok,
  orElse,
  tryCatch,
  tryPromise,
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

describe("result composition", () => {
  test("results stay plain wire shapes: the iterator is non-enumerable", () => {
    const success = ok({ id: "one" });
    expect(Object.keys(success)).toEqual(["ok", "value"]);
    expect(JSON.stringify(success)).toBe('{"ok":true,"value":{"id":"one"}}');
    expect(Object.isFrozen(success)).toBe(true);
  });

  test("gen unwraps yielded successes and returns ok", () => {
    const outcome = gen(function* () {
      const doc = yield* find("one");
      const size = yield* parse(doc);
      return `${doc}/${size}`;
    });
    expect(outcome).toEqual(ok("doc:one/7"));
  });

  test("gen short-circuits on the first Err and runs finally blocks", () => {
    let cleaned = false;
    const outcome = gen(function* () {
      try {
        const doc = yield* find("missing");
        return yield* parse(doc);
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
      return 1;
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
      return size * 2;
    });
    expect(outcome).toEqual(ok(14));
    const failure = await gen(async function* () {
      const doc = yield* await fetchDoc("missing");
      return doc;
    });
    expect(failure).toEqual(err(NotFound({ id: "missing" })));
  });

  test("tryCatch adopts a throwing function behind a tagged error", () => {
    const good = tryCatch(
      () => JSON.parse('{"a":1}') as { a: number },
      (cause) => ParseFailure({ reason: String(cause) }),
    );
    expect(good).toEqual(ok({ a: 1 }));
    const bad = tryCatch(
      () => JSON.parse("nope") as never,
      () => ParseFailure({ reason: "invalid json" }),
    );
    expect(bad).toEqual(err(ParseFailure({ reason: "invalid json" })));
  });

  test("tryPromise catches rejections and sync throws", async () => {
    const rejected = await tryPromise(
      () => Promise.reject(new Error("boom")),
      () => ParseFailure({ reason: "rejected" }),
    );
    expect(rejected).toEqual(err(ParseFailure({ reason: "rejected" })));
    const thrown = await tryPromise(
      () => {
        throw new Error("early");
      },
      () => ParseFailure({ reason: "threw" }),
    );
    expect(thrown).toEqual(err(ParseFailure({ reason: "threw" })));
    const good = await tryPromise(
      async () => 3,
      () => ParseFailure({ reason: "" }),
    );
    expect(good).toEqual(ok(3));
  });

  test("all combines tuples and records, first failure wins", () => {
    expect(all([find("a"), parse("xy")])).toEqual(ok(["doc:a", 2]));
    expect(all([find("missing"), parse("bad")])).toEqual(err(NotFound({ id: "missing" })));
    expect(all({ doc: find("a"), size: parse("xy") })).toEqual(ok({ doc: "doc:a", size: 2 }));
    expect(all({ doc: find("a"), size: parse("bad") })).toEqual(
      err(ParseFailure({ reason: "bad" })),
    );
  });

  test("orElse recovers a failure; getOrElse unwraps with fallback", () => {
    const recovered = orElse(find("missing"), () => ok("doc:fallback"));
    expect(recovered).toEqual(ok("doc:fallback"));
    expect(getOrElse(find("missing"), (failure) => failure.data.id)).toBe("missing");
    expect(getOrElse(find("one"), () => "unused")).toBe("doc:one");
  });
});

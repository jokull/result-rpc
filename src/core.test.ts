import { describe, expect, test } from "bun:test";
import {
  TaggedError,
  andThen,
  defineErrors,
  deserialize,
  err,
  error,
  errorCatalog,
  isTaggedError,
  matchError,
  ok,
  serialize,
  wire,
} from "./index.js";
import { rpc } from "./server/contract.js";
import { encodeUnknownWireValue } from "./wire.js";
import type { AnyWireCodec, WireCodec, WireValue } from "./wire.js";

const NotFound = error({
  tag: "test/not-found",
  data: wire.object({ id: wire.string }),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
});

const Offline = error({
  tag: "test/offline",
  data: wire.object({}),
  httpStatus: 503,
  retry: "transient",
  visibility: "public",
});

describe("wire codecs", () => {
  test("an empty object codec rejects primitives and undeclared fields", () => {
    const codec = wire.object({});
    expect(codec.encode({})).toEqual({ ok: true, value: {} });
    expect(codec.encode(123 as never).ok).toBe(false);
    expect(codec.encode({ unexpected: true } as never).ok).toBe(false);
  });

  test("serializable requires shape evidence when decoding", () => {
    const User = wire.serializable(
      (value): value is { readonly id: string } =>
        value !== null &&
        typeof value === "object" &&
        "id" in value &&
        typeof value.id === "string",
      { id: "core/user/v1" },
    );
    expect(User.decode({ id: "u1" })).toEqual({ ok: true, value: { id: "u1" } });
    expect(User.decode("shape-compatible only by assertion").ok).toBe(false);
  });

  test("encode and decode exact plain objects", () => {
    const codec = wire.object({ id: wire.string, count: wire.integer({ min: 0 }) });
    expect(codec.encode({ id: "a", count: 1 })).toEqual({
      ok: true,
      value: { id: "a", count: 1 },
    });
    expect(codec.decode({ id: "a", count: -1 }).ok).toBe(false);
    expect(codec.decode({ id: "a", count: 1, extra: true }).ok).toBe(false);
    expect(
      codec.decode(
        new (class Value {
          id = "a";
          count = 1;
        })(),
      ).ok,
    ).toBe(false);
  });

  test("supports non-finite numbers unless a finite codec is requested", () => {
    expect(wire.number.encode(Number.NaN).ok).toBe(true);
    expect(wire.number.decode(Number.POSITIVE_INFINITY).ok).toBe(true);
    expect(wire.finiteNumber.encode(Number.NaN).ok).toBe(false);
    expect(wire.finiteNumber.decode(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  test("string enums preserve their literal union and expanded contract identity", () => {
    const codec = wire.enum(["draft", "published"]);
    const expanded = wire.union([wire.literal("draft"), wire.literal("published")]);

    expect(codec.encode("draft")).toEqual({ ok: true, value: "draft" });
    expect(codec.decode("published")).toEqual({ ok: true, value: "published" });
    expect(codec.decode("archived").ok).toBe(false);
    expect(codec.decode(1).ok).toBe(false);
    expect(codec.kind).toBe(expanded.kind);
    expect(codec.schema).toBe(expanded.schema);
  });

  test("supports optional object fields and prototype-safe records", () => {
    const codec = wire.object({
      name: wire.string,
      note: wire.optional(wire.string),
      labels: wire.record(wire.string),
    });
    expect(codec.decode({ name: "trip", labels: { region: "north" } })).toEqual({
      ok: true,
      value: { name: "trip", labels: { region: "north" } },
    });
    const decoded = codec.decode({ name: "trip", note: undefined, labels: {} });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(Object.getPrototypeOf(decoded.value.labels)).toBeNull();
    expect(codec.decode({ name: "trip", labels: { region: 1 } }).ok).toBe(false);

    const protoCodec = wire.object({ ["__proto__"]: wire.string });
    const input = Object.create(null) as { ["__proto__"]: string };
    Object.defineProperty(input, "__proto__", { value: "data", enumerable: true });
    const protoResult = protoCodec.decode(input);
    expect(protoResult.ok).toBe(true);
    if (protoResult.ok) {
      expect(Object.getPrototypeOf(protoResult.value)).toBe(Object.prototype);
      expect(Object.hasOwn(protoResult.value, "__proto__")).toBe(true);
    }
  });

  test("equal built-in schemas have equivalent boundary acceptance", () => {
    const pairs: readonly (readonly [AnyWireCodec, AnyWireCodec, readonly unknown[]])[] = [
      [
        wire.integer({ min: -1, max: 3 }),
        wire.integer({ min: -1, max: 3 }),
        [-2, -1, 0, 3, 4, 1.5, "1", Number.NaN],
      ],
      [
        wire.array(wire.optional(wire.string)),
        wire.array(wire.optional(wire.string)),
        [[], ["a", undefined], [1], {}, null],
      ],
      [
        wire.record(wire.finiteNumber),
        wire.record(wire.finiteNumber),
        [{}, { one: 1 }, { bad: Number.NaN }, [], new (class RecordLike {})()],
      ],
      [
        wire.union([wire.literal("ready"), wire.null]),
        wire.union([wire.literal("ready"), wire.null]),
        ["ready", "other", null, undefined, {}],
      ],
      [
        wire.object({
          count: wire.integer({ min: 0 }),
          label: wire.string,
          note: wire.optional(wire.string),
        }),
        wire.object({
          note: wire.optional(wire.string),
          label: wire.string,
          count: wire.integer({ min: 0 }),
        }),
        [
          { count: 1, label: "one" },
          { count: 1, label: "one", note: "ok" },
          { count: -1, label: "one" },
          { count: 1, label: "one", extra: true },
          Object.assign(Object.create(null), { count: 1, label: "one" }),
          new (class Row {
            count = 1;
            label = "one";
          })(),
        ],
      ],
    ];

    for (const [left, right, candidates] of pairs) {
      expect(left.schema).toBe(right.schema);
      for (const candidate of candidates) {
        expect(encodeUnknownWireValue(left, candidate).ok).toBe(
          encodeUnknownWireValue(right, candidate).ok,
        );
        expect(left.decode(candidate).ok).toBe(right.decode(candidate).ok);
      }
    }
  });

  test("round trips rich values, cycles, and repeated references", () => {
    const shared = { createdAt: new Date("2026-01-01T00:00:00.000Z") };
    const value: {
      shared: typeof shared;
      repeated: typeof shared;
      self?: unknown;
      count: bigint;
      values: Set<number>;
      params: URLSearchParams;
      map: Map<string, Date>;
      buffer: ArrayBuffer;
      bytes: Uint16Array;
    } = {
      shared,
      repeated: shared,
      count: 42n,
      values: new Set([1, 2]),
      params: new URLSearchParams({ region: "north" }),
      map: new Map([["created", new Date("2026-01-02T00:00:00.000Z")]]),
      buffer: new Uint8Array([1, 2, 3]).buffer,
      bytes: new Uint16Array([500, 1_000]),
    };
    value.self = value;

    const encoded = serialize(value);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = deserialize(encoded.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const roundTrip = decoded.value as typeof value;
    expect(roundTrip.shared.createdAt).toBeInstanceOf(Date);
    expect(roundTrip.repeated).toBe(roundTrip.shared);
    expect(roundTrip.self).toBe(roundTrip);
    expect(roundTrip.count).toBe(42n);
    expect(roundTrip.values).toEqual(new Set([1, 2]));
    expect(roundTrip.params).toEqual(new URLSearchParams({ region: "north" }));
    expect(roundTrip.map).toEqual(new Map([["created", new Date("2026-01-02T00:00:00.000Z")]]));
    expect(new Uint8Array(roundTrip.buffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(roundTrip.bytes).toEqual(new Uint16Array([500, 1_000]));
  });
});

describe("tagged errors", () => {
  test("implicit empty data is exactly the strict empty-object codec", () => {
    const Implicit = error({ tag: "test/implicit-empty" });
    const Explicit = error({
      tag: "test/explicit-empty",
      data: wire.object({}),
    });
    expect(Implicit.codec.schema).toBe(Explicit.codec.schema);
    for (const data of [
      {},
      Object.create(null),
      { unexpected: true },
      [],
      null,
      new (class Empty {})(),
    ]) {
      expect(Implicit.codec.encode(data as never).ok).toBe(Explicit.codec.encode(data as never).ok);
      expect(Implicit.codec.decode(data).ok).toBe(Explicit.codec.decode(data).ok);
    }
    expect(Implicit.decode({ _tag: Implicit.tag, data: { unexpected: true } }).ok).toBe(false);
  });

  test("catalogs narrow unknown values to their exact error union", () => {
    const message = errorCatalog(
      { NotFound, Offline },
      {
        "test/not-found": (failure) => `Missing ${failure.data.id}`,
        "test/offline": () => "Offline",
      },
    );
    const failure: unknown = NotFound({ id: "trip_1" });
    expect(message.is(failure)).toBe(true);
    if (message.is(failure)) expect(message(failure)).toBe("Missing trip_1");
    expect(message.is(new Error("nope"))).toBe(false);
    expect(message.is({ _tag: "test/not-found", data: { id: "trip_1" } })).toBe(false);
  });

  test("catalogs reject distinct definitions that reuse one tag", () => {
    const DuplicateNotFound = error({
      tag: "test/not-found",
      data: wire.object({ id: wire.string }),
    });
    expect(() =>
      errorCatalog({ NotFound, DuplicateNotFound }, { "test/not-found": () => "unreachable" }),
    ).toThrow(/conflicting definitions/);
  });

  test("creates frozen instances with a structural wire representation", () => {
    const value = NotFound({ id: "trip_1" });
    expect(value.toJSON()).toEqual({ _tag: "test/not-found", data: { id: "trip_1" } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.data)).toBe(true);
    expect(value).toBeInstanceOf(Error);
    expect(value).toBeInstanceOf(TaggedError);
    expect(TaggedError.is(value)).toBe(true);
    expect(isTaggedError(value)).toBe(true);
    expect(NotFound.is(value)).toBe(true);
    expect(value.visibility).toBe("public");

    const serialized = JSON.parse(JSON.stringify(value));
    expect(NotFound.is(serialized)).toBe(false);
    const decoded = NotFound.decode(serialized);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(NotFound.is(decoded.value)).toBe(true);
  });

  test("retains a local cause without putting it on the wire", () => {
    const cause = new Error("private database detail");
    const value = NotFound({ id: "missing" }, { cause });

    expect(value.cause).toBe(cause);
    expect(Object.keys(value)).not.toContain("cause");
    expect(JSON.stringify(value)).not.toContain("private database detail");
    const encoded = serialize(value.toJSON());
    expect(encoded.ok).toBe(true);
    if (encoded.ok) expect(encoded.value).not.toContain("private database detail");
    const decoded = NotFound.decode(value.toJSON());
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.cause).toBeUndefined();
  });

  test("rejects invalid runtime input", () => {
    expect(() => NotFound({ id: 1 } as never)).toThrow("Invalid data");
  });

  test("serializer preflight rejects a custom codec that lies", () => {
    const lyingCodec = {
      kind: "lying",
      schema: '["test","lying"]',
      encode: () => ({ ok: true, value: () => undefined }),
      decode: () => ({ ok: true, value: "claimed-safe" }),
    } as unknown as WireCodec<string, WireValue>;
    const Lying = error({
      tag: "test/lying",
      data: lyingCodec,
      httpStatus: 500,
      retry: "never",
      visibility: "public",
    });
    expect(() => Lying("value")).toThrow("not wire-serializable");
  });

  test("error definition guards contain throwing custom decoders", () => {
    const throwingCodec = {
      kind: "throwing",
      schema: '["test","throwing"]',
      encode: (value: string) => ({ ok: true as const, value }),
      decode: () => {
        throw new Error("decoder defect");
      },
    } satisfies WireCodec<string, string>;
    const Throwing = error({
      tag: "test/throwing-decoder",
      data: throwingCodec,
      httpStatus: 500,
      retry: "never",
      visibility: "public",
    });
    expect(Throwing.is({ _tag: Throwing.tag, data: "value" })).toBe(false);
    expect(Throwing.decode({ _tag: Throwing.tag, data: "value" }).ok).toBe(false);
  });

  test("error construction enforces a bounded encoded representation", () => {
    const Bounded = error({
      tag: "test/bounded",
      data: wire.object({ text: wire.string }),
      httpStatus: 400,
      retry: "never",
      visibility: "public",
    });
    expect(() => Bounded({ text: "x".repeat(70_000) })).toThrow("not wire-serializable");
  });

  test("reserves framework error namespaces", () => {
    expect(() =>
      error({
        tag: "client/impostor",
        data: wire.object({}),
        httpStatus: 500,
        retry: "never",
        visibility: "public",
      }),
    ).toThrow("reserved framework namespace");
  });
});

describe("Result", () => {
  test("accumulates and matches tagged failures", () => {
    const first = ok(1) as
      | ReturnType<typeof ok<number>>
      | ReturnType<typeof err<ReturnType<typeof Offline>>>;
    const result = andThen(first, () => err(NotFound({ id: "missing" })));
    expect(result.isOk()).toBe(false);
    if (!result.isOk()) {
      const text = matchError(result.error, {
        "test/offline": () => "offline",
        "test/not-found": (failure) => failure.data.id,
      });
      expect(text).toBe("missing");
    }
  });
});

describe("error registry", () => {
  test("the router rejects one tag with two definitions", () => {
    const r = rpc.context<{}>();
    const A = error({ tag: "acct/limit", httpStatus: 409 });
    const B = error({
      tag: "acct/limit",
      data: wire.object({ max: wire.number }),
      httpStatus: 409,
    });
    const make = (definition: typeof A | typeof B) =>
      r
        .procedure()
        .output(wire.string)
        .errors({ Limit: definition })
        .query(() => ok(""));
    expect(() => r.router({ one: make(A), two: make(B) })).toThrow(
      /acct\/limit has conflicting definitions in one and two/,
    );
  });

  test("two procedures sharing one definition reference are canonical", () => {
    const r = rpc.context<{}>();
    const Limit = error({ tag: "acct2/limit", httpStatus: 409 });
    const make = () =>
      r
        .procedure()
        .output(wire.string)
        .errors({ Limit })
        .query(() => ok(""));
    const router = r.router({ one: make(), two: make() });
    expect(router.errors.get("acct2/limit")).toBe(Limit);
    expect([...router.errors.keys()]).toEqual(["acct2/limit"]);
  });

  test("defineErrors derives tags from keys under one namespace", () => {
    const docErrors = defineErrors("trip2", {
      notFound: { data: wire.object({ docId: wire.string }), httpStatus: 404 },
      titleTaken: { httpStatus: 409 },
    });
    expect(docErrors.notFound({ docId: "t1" }).toJSON()).toEqual({
      _tag: "trip2/not-found",
      data: { docId: "t1" },
    });
    expect(docErrors.titleTaken().toJSON()).toEqual({ _tag: "trip2/title-taken", data: {} });
    expect(docErrors.notFound.policy.retry).toBe("never");
    expect(() => defineErrors("client", { x: { httpStatus: 400 } })).toThrow(
      /reserved framework namespace/,
    );
    expect(() => defineErrors("a/b", { x: { httpStatus: 400 } })).toThrow(/must not contain/);
  });
});

describe("wire.nullable", () => {
  // A spelling of `wire.union([codec, wire.null])`, so it must behave as that
  // union in every respect — including on the wire, where any difference would
  // change the contract digest and desync deployed clients.
  test("round-trips the value and null", () => {
    const codec = wire.nullable(wire.string);
    expect(codec.decode("ada")).toEqual({ ok: true, value: "ada" });
    expect(codec.decode(null)).toEqual({ ok: true, value: null });
    expect(codec.encode("ada")).toEqual({ ok: true, value: "ada" });
    expect(codec.encode(null)).toEqual({ ok: true, value: null });
  });

  test("rejects undefined — nullable is present-and-null, not absent", () => {
    expect(wire.nullable(wire.string).decode(undefined).ok).toBe(false);
  });

  test("is the union it replaces, so the contract digest cannot move", () => {
    expect(wire.nullable(wire.string).kind).toBe(wire.union([wire.string, wire.null]).kind);
  });
});

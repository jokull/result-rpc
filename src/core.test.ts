import { describe, expect, test } from "bun:test";
import { andThen, deserialize, err, error, matchError, ok, serialize, wire } from "./index.js";
import type { WireCodec, WireValue } from "./wire.js";

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
  test("encode and decode exact plain objects", () => {
    const codec = wire.object({ id: wire.string, count: wire.integer({ min: 0 }) });
    expect(codec.encode({ id: "a", count: 1 })).toEqual({
      ok: true,
      value: { id: "a", count: 1 },
    });
    expect(codec.decode({ id: "a", count: -1 }).ok).toBe(false);
    expect(codec.decode({ id: "a", count: 1, extra: true }).ok).toBe(false);
    expect(codec.decode(new (class Value { id = "a"; count = 1; })()).ok).toBe(false);
  });

  test("supports non-finite numbers unless a finite codec is requested", () => {
    expect(wire.number.encode(Number.NaN).ok).toBe(true);
    expect(wire.number.decode(Number.POSITIVE_INFINITY).ok).toBe(true);
    expect(wire.finiteNumber.encode(Number.NaN).ok).toBe(false);
    expect(wire.finiteNumber.decode(Number.POSITIVE_INFINITY).ok).toBe(false);
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
    expect(roundTrip.map).toEqual(new Map([
      ["created", new Date("2026-01-02T00:00:00.000Z")],
    ]));
    expect(new Uint8Array(roundTrip.buffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(roundTrip.bytes).toEqual(new Uint16Array([500, 1_000]));
  });
});

describe("tagged errors", () => {
  test("creates frozen structural wire values", () => {
    const value = NotFound({ id: "trip_1" });
    expect(value).toEqual({ _tag: "test/not-found", data: { id: "trip_1" } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.data)).toBe(true);
    expect(value).not.toBeInstanceOf(Error);
    expect(NotFound.is(JSON.parse(JSON.stringify(value)))).toBe(true);
  });

  test("rejects invalid runtime input", () => {
    expect(() => NotFound({ id: 1 } as never)).toThrow("Invalid data");
  });

  test("serializer preflight rejects a custom codec that lies", () => {
    const lyingCodec = {
      kind: "lying",
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
      encode: (value: string) => ({ ok: true as const, value }),
      decode: () => { throw new Error("decoder defect"); },
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
    expect(() => error({
      tag: "client/impostor",
      data: wire.object({}),
      httpStatus: 500,
      retry: "never",
      visibility: "public",
    })).toThrow("reserved framework namespace");
  });
});

describe("Result", () => {
  test("accumulates and matches tagged failures", () => {
    const first = ok(1) as ReturnType<typeof ok<number>> | ReturnType<typeof err<ReturnType<typeof Offline>>>;
    const result = andThen(first, () => err(NotFound({ id: "missing" })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const text = matchError(result.error, {
        "test/offline": () => "offline",
        "test/not-found": (failure) => failure.data.id,
      });
      expect(text).toBe("missing");
    }
  });
});

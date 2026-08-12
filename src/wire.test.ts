import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { deserialize, serialize } from "./serializer.js";
import { failure, success, wire, type WireCodec, type WireValue } from "./index.js";

/**
 * A dependency-free stand-in for a calendar date: the application value is a
 * record, the wire value is the "YYYY-MM-DD" string. With `wire.plainDate`
 * natively on the wire, this transformation is only needed when the domain
 * type is not a Temporal class.
 */
const iso = (date: { year: number; month: number; day: number }) =>
  `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(
    date.day,
  ).padStart(2, "0")}`;

const dateCodec = wire.codec({
  id: "calendar-date/v1",
  wire: wire.string,
  encode: (date: { year: number; month: number; day: number }) => success(iso(date)),
  decode: (value) => {
    const [year, month, day] = (value as string).split("-").map(Number);
    if (year === undefined || month === undefined || day === undefined) {
      return failure("Expected YYYY-MM-DD");
    }
    return success({ year, month, day });
  },
});

describe("wire.codec", () => {
  test("round-trips an application value through its wire projection", () => {
    const encoded = dateCodec.encode({ year: 2026, month: 8, day: 7 });
    expect(encoded).toEqual({ ok: true, value: "2026-08-07" });
    const decoded = dateCodec.decode("2026-08-07");
    expect(decoded).toEqual({ ok: true, value: { year: 2026, month: 8, day: 7 } });
  });

  test("encode failures propagate", () => {
    const result = wire
      .codec<number, string>({
        id: "v1",
        wire: wire.string,
        encode: () => failure("Out of range"),
        decode: (value) => success(Number(value)),
      })
      .encode(1);
    expect(result).toEqual({ ok: false, issues: [{ message: "Out of range", path: [] }] });
  });

  test("the wire codec gates the encode side at runtime", () => {
    // a codec whose encode produces a value the inner wire codec rejects
    // is stopped before it reaches the serializer
    const bounded = wire.codec<number, number>({
      id: "v1",
      wire: wire.integer({ min: 0, max: 100 }),
      encode: (input) => success(input * 2),
      decode: (value) => success(value as number),
    });
    expect(bounded.encode(60).ok).toBe(false); // 120 is out of the wire range
    expect(bounded.encode(10)).toEqual({ ok: true, value: 20 });

    // garbage on the wire never reaches the custom decoder
    expect(dateCodec.decode(42).ok).toBe(false);
  });

  test("kind names the wire projection for diagnostics", () => {
    expect(dateCodec.kind).toBe("codec(string)");
  });

  test("the digest changes with the id and with the wire shape", () => {
    const base = dateCodec.schema;
    const renamed = wire.codec({
      id: "calendar-date/v2",
      wire: wire.string,
      encode: dateCodec.encode,
      decode: dateCodec.decode,
    }).schema;
    // same id, different wire shape (enum of two dates vs any string)
    const retyped = wire.codec({
      id: "calendar-date/v1",
      wire: wire.enum(["2026-08-07", "2026-08-08"] as const),
      encode: () => success("2026-08-07" as const),
      decode: (_value) => success({ year: 2026, month: 8, day: 7 }),
    }).schema;
    expect(renamed).not.toBe(base);
    expect(retyped).not.toBe(base);
    // the same id and wire shape are stable across construction
    expect(
      wire.codec({
        id: "calendar-date/v1",
        wire: wire.string,
        encode: dateCodec.encode,
        decode: dateCodec.decode,
      }).schema,
    ).toBe(base);
  });

  test("composes inside wire.object", () => {
    const envelope = wire.object({ date: dateCodec });
    expect(envelope.encode({ date: { year: 2026, month: 8, day: 7 } })).toEqual({
      ok: true,
      value: { date: "2026-08-07" },
    });
    expect(envelope.decode({ date: "2026-08-07" })).toEqual({
      ok: true,
      value: { date: { year: 2026, month: 8, day: 7 } },
    });
  });
});

describe("wire temporal codecs", () => {
  test("each class round-trips as an identity codec", () => {
    const roundTrip = <T extends WireValue>(codec: WireCodec<T, T>, value: T) => {
      expect(codec.encode(value)).toEqual({ ok: true, value });
      expect(codec.decode(value)).toEqual({ ok: true, value });
    };

    roundTrip(wire.plainDate, Temporal.PlainDate.from("2026-08-07"));
    roundTrip(wire.plainDateTime, Temporal.PlainDateTime.from("2026-08-07T13:42:00"));
    roundTrip(wire.plainTime, Temporal.PlainTime.from("13:42:00"));
    roundTrip(wire.plainYearMonth, Temporal.PlainYearMonth.from("2026-08"));
    roundTrip(wire.plainMonthDay, Temporal.PlainMonthDay.from("08-07"));
    roundTrip(wire.instant, Temporal.Instant.from("2026-08-07T13:42:00Z"));
    roundTrip(
      wire.zonedDateTime,
      Temporal.ZonedDateTime.from("2026-08-07T13:42:00+02:00[Europe/Paris]"),
    );
    roundTrip(wire.duration, Temporal.Duration.from("P1DT2H30M"));
  });

  test("values survive the full serialize/deserialize wire pipeline", () => {
    const envelope = wire.object({
      date: wire.plainDate,
      instant: wire.instant,
      zoned: wire.zonedDateTime,
      duration: wire.duration,
      list: wire.array(wire.plainTime),
    });
    const input = {
      date: Temporal.PlainDate.from("2026-08-07"),
      instant: Temporal.Instant.from("2026-08-07T13:42:00Z"),
      zoned: Temporal.ZonedDateTime.from("2026-08-07T13:42:00+02:00[Europe/Paris]"),
      duration: Temporal.Duration.from("P1DT2H30M"),
      list: [Temporal.PlainTime.from("13:42:00")],
    };
    const encoded = envelope.encode(input);
    expect(encoded.ok).toBe(true);
    const serialized = serialize(encoded.ok ? encoded.value : undefined);
    expect(serialized.ok).toBe(true);
    const revived = deserialize(serialized.ok ? serialized.value : "");
    expect(revived.ok).toBe(true);
    const decoded = envelope.decode(revived.ok ? revived.value : undefined);
    expect(decoded).toEqual({ ok: true, value: input });
    expect(decoded.ok && decoded.value.date).toBeInstanceOf(Temporal.PlainDate);
  });

  test("a wrong Temporal class is rejected on encode and decode", () => {
    // tsc rejects the mismatched type before this ever runs; the cast
    // exercises the runtime instanceof guard behind the type wall
    const wrongInstance = Temporal.Instant.from("2026-08-07T13:42:00Z");
    expect(wire.plainDate.encode(wrongInstance as unknown as Temporal.PlainDate).ok).toBe(false);
    expect(wire.plainDate.decode(wrongInstance).ok).toBe(false);
    // a plain record that looks like a date is not a Temporal instance
    expect(wire.plainDate.decode({ year: 2026, month: 8, day: 7 }).ok).toBe(false);
    // the canonical string is the wire encoding, not a value the codec accepts
    expect(wire.plainDate.decode("2026-08-07").ok).toBe(false);
  });

  test("kind and schema digest distinguish the classes", () => {
    expect(wire.plainDate.kind).toBe("temporal/plain-date");
    expect(wire.plainDate.schema).toBe(wire.plainDate.schema);
    expect(wire.plainDate.schema).not.toBe(wire.plainDateTime.schema);
    expect(wire.plainDate.schema).not.toBe(wire.date.schema);
    expect(wire.instant.schema).not.toBe(wire.zonedDateTime.schema);
  });
});

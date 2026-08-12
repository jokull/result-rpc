import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { failure, success, wire, type WireCodec } from "./index.js";

/**
 * A dependency-free stand-in for a calendar date: the application value is a
 * record, the wire value is the "YYYY-MM-DD" string. The blog experiment
 * uses the same codec shape with Temporal.PlainDate on the application side.
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
		const renamed = wire
			.codec({ id: "calendar-date/v2", wire: wire.string, encode: dateCodec.encode, decode: dateCodec.decode })
			.schema;
		// same id, different wire shape (enum of two dates vs any string)
		const retyped = wire
			.codec({
				id: "calendar-date/v1",
				wire: wire.enum(["2026-08-07", "2026-08-08"] as const),
				encode: () => success("2026-08-07" as const),
				decode: (value) => success({ year: 2026, month: 8, day: 7 }),
			})
			.schema;
		expect(renamed).not.toBe(base);
		expect(retyped).not.toBe(base);
		// the same id and wire shape are stable across construction
		expect(
			wire
				.codec({ id: "calendar-date/v1", wire: wire.string, encode: dateCodec.encode, decode: dateCodec.decode })
				.schema,
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

describe("wire.temporal", () => {
	test("plainDate projects to YYYY-MM-DD and rebuilds the instance", () => {
		const date = Temporal.PlainDate.from("2026-08-07");
		expect(wire.temporal.plainDate.encode(date)).toEqual({
			ok: true,
			value: "2026-08-07",
		});
		const decoded = wire.temporal.plainDate.decode("2026-08-07");
		expect(decoded).toEqual({ ok: true, value: date });
		expect(decoded.ok && decoded.value).toBeInstanceOf(Temporal.PlainDate);
	});

	test("each class round-trips through its canonical string", () => {
		const roundTrip = <T>(codec: WireCodec<T, string>, value: T) => {
			const encoded = codec.encode(value);
			expect(encoded.ok).toBe(true);
			const decoded = codec.decode(encoded.ok ? encoded.value : "");
			expect(decoded).toEqual({ ok: true, value });
		};

		roundTrip(wire.temporal.plainDateTime, Temporal.PlainDateTime.from("2026-08-07T13:42:00"));
		roundTrip(wire.temporal.plainTime, Temporal.PlainTime.from("13:42:00"));
		roundTrip(wire.temporal.plainYearMonth, Temporal.PlainYearMonth.from("2026-08"));
		roundTrip(wire.temporal.plainMonthDay, Temporal.PlainMonthDay.from("08-07"));
		roundTrip(wire.temporal.instant, Temporal.Instant.from("2026-08-07T13:42:00Z"));
		roundTrip(
			wire.temporal.zonedDateTime,
			Temporal.ZonedDateTime.from("2026-08-07T13:42:00+02:00[Europe/Paris]"),
		);
		roundTrip(wire.temporal.duration, Temporal.Duration.from("P1DT2H30M"));
	});

	test("a wrong instance type is rejected on encode", () => {
		// tsc rejects the mismatched type before this ever runs; the cast
		// exercises the runtime instanceof guard behind the type wall
		const wrongInstance = Temporal.Instant.from("2026-08-07T13:42:00Z");
		expect(
			wire.temporal.plainDate.encode(wrongInstance as unknown as Temporal.PlainDate).ok,
		).toBe(false);
	});

	test("a well-formed string that is not a valid value is rejected on decode", () => {
		expect(wire.temporal.plainDate.decode("2026-13-99").ok).toBe(false);
		expect(wire.temporal.plainTime.decode("25:00:00").ok).toBe(false);
	});
});

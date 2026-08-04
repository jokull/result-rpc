import { describe, expect, test } from "bun:test";
import { Result as BetterResult } from "better-result";
import { error } from "./error.js";
import { wire } from "./wire.js";
import { procedureResultCodec } from "./procedure-result-codec.js";

const NotFound = error({
  tag: "thing/not-found",
  data: wire.object({ id: wire.string }),
  httpStatus: 404,
});
const Forbidden = error({
  tag: "thing/forbidden",
  data: wire.object({ reason: wire.string }),
  httpStatus: 403,
});
const Hidden = error({
  tag: "vault/hidden",
  data: wire.object({ leak: wire.string }),
  visibility: "private",
});

const output = wire.object({ id: wire.string, label: wire.string });

const codec = procedureResultCodec(output, {
  "thing/not-found": NotFound,
  "thing/forbidden": Forbidden,
});

/** Codec failures surface as `unknown` in the deserialize union — tag is the stable witness. */
const tagOf = (error: unknown): string | undefined =>
  error !== null && typeof error === "object" && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : undefined;

describe("per-procedure Result codec", async () => {
  test("serializes an Ok through the output wire codec", async () => {
    const serialized = await codec.serialize(BetterResult.ok({ id: "1", label: "a" }));
    if (!serialized.isOk()) throw new Error("expected ok");
    expect(serialized.value).toEqual({
      status: "ok",
      value: { id: "1", label: "a" },
    });
  });

  test("deserializes an Ok payload back to the app value", async () => {
    const serialized = await codec.serialize(BetterResult.ok({ id: "1", label: "a" }));
    if (!serialized.isOk()) throw new Error("expected ok");
    const roundTrip = await codec.deserialize(serialized.value);
    if (!roundTrip.isOk()) throw new Error("expected ok round trip");
    expect(roundTrip.value).toEqual({ id: "1", label: "a" });
  });

  test("serializes a declared public Err to { _tag, data }", async () => {
    const failure = NotFound({ id: "1" });
    const serialized = await codec.serialize(BetterResult.err(failure));
    if (!serialized.isOk()) throw new Error("expected ok");
    expect(serialized.value).toEqual({
      status: "error",
      error: { _tag: "thing/not-found", data: { id: "1" } },
    });
  });

  test("deserialize of an error envelope reifies the exact declared instance", async () => {
    const encoded = { _tag: "thing/forbidden", data: { reason: "no" } };
    const reified = await codec.deserialize({ status: "error", error: encoded });
    if (reified.isOk()) throw new Error("expected err");
    expect(Forbidden.is(reified.error)).toBe(true);
    if (Forbidden.is(reified.error)) {
      expect(reified.error.data.reason).toBe("no");
    }
  });

  test("serialize rejects a counterfeit error with a codec failure, not a domain result", async () => {
    // A shape-compatible plain object is not a reified result-rpc error —
    // it must not ride the boundary as if it were one.
    const fake = { _tag: "thing/not-found", data: { id: "1" } };
    const serialized = await codec.serialize(BetterResult.err(fake as never));
    if (serialized.isOk()) throw new Error("expected a codec failure");
    expect(serialized.error._tag).toBe("ResultSerializationError");
  });

  test("deserialize rejects unknown and private tags as codec issues, never domain results", async () => {
    const unknown = await codec.deserialize({
      status: "error",
      error: { _tag: "hostile/unknown", data: {} },
    });
    if (unknown.isOk()) throw new Error("expected a codec failure");
    expect(tagOf(unknown.error)).toBe("ResultDeserializationError");

    const privateError = Hidden({ leak: "secret" });
    const serialized = await codec.serialize(BetterResult.err(privateError));
    if (serialized.isOk()) throw new Error("expected a codec failure");
    expect(tagOf(serialized.error)).toBe("ResultSerializationError");
  });

  test("codec failures are framework failures, never domain errors", async () => {
    const badOutput = await codec.serialize(BetterResult.ok({ id: 1 as never, label: "x" }));
    if (badOutput.isOk()) throw new Error("expected a codec failure");
    expect(badOutput.error._tag).toBe("ResultSerializationError");

    const malformed = await codec.deserialize({
      status: "error",
      error: { _tag: "thing/not-found", data: { id: 42 } },
    });
    if (malformed.isOk()) throw new Error("expected a codec failure");
    expect(tagOf(malformed.error)).toBe("ResultDeserializationError");
  });

  test("a non-Result payload is a ResultDeserializationError", async () => {
    const decoded = await codec.deserialize({ status: "nope" } as never);
    if (decoded.isOk()) throw new Error("expected a codec failure");
    expect(tagOf(decoded.error)).toBe("ResultDeserializationError");
  });
});

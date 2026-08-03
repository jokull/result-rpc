import { describe, expect, test } from "bun:test";
import {
  decodeRequestEnvelope,
  decodeResponseEnvelope,
  decodeStreamFrame,
  PROTOCOL_VERSION,
} from "./protocol.js";

describe("protocol decoders", () => {
  test("construct validated request envelopes instead of trusting nested input", () => {
    expect(
      decodeRequestEnvelope({ v: PROTOCOL_VERSION, path: "doc.read", input: { id: "d1" } }),
    ).toEqual({ v: PROTOCOL_VERSION, path: "doc.read", input: { id: "d1" } });
    expect(
      decodeRequestEnvelope({ v: PROTOCOL_VERSION, path: "doc.read", input: () => undefined }),
    ).toBeUndefined();
  });

  test("rejects malformed values, errors, and touched metadata", () => {
    expect(
      decodeResponseEnvelope({ v: PROTOCOL_VERSION, status: "ok", value: new Error("private") }),
    ).toBeUndefined();
    expect(
      decodeResponseEnvelope({
        v: PROTOCOL_VERSION,
        status: "error",
        error: { _tag: "doc/missing", data: Symbol("not-wire") },
      }),
    ).toBeUndefined();
    expect(
      decodeResponseEnvelope({ v: PROTOCOL_VERSION, status: "ok", value: null, touched: 1 }),
    ).toBeUndefined();
  });

  test("validates stream sequence numbers without asserting them", () => {
    expect(decodeStreamFrame({ v: PROTOCOL_VERSION, seq: "1", done: true })).toBeUndefined();
    expect(decodeStreamFrame({ v: PROTOCOL_VERSION, seq: 1, done: true })).toEqual({
      v: PROTOCOL_VERSION,
      seq: 1,
      done: true,
    });
  });
});

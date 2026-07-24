import { describe, expect, test } from "bun:test";
import { ServerBadRequest, wire } from "./index.js";
import { fieldIssues, type StandardSchemaV1 } from "./standard-schema.js";

describe("validators on the wire", () => {
  test("wire.standard adopts an external Standard Schema as the input codec", () => {
    // a hand-rolled Standard Schema standing in for Valibot/Zod/ArkType
    const LoginSchema: StandardSchemaV1<{ email: string }> = {
      "~standard": {
        version: 1,
        vendor: "hand-rolled",
        validate: (value) => {
          const record = value as { email?: unknown };
          return typeof record?.email === "string" && record.email.includes("@")
            ? { value: { email: record.email } }
            : { issues: [{ message: "Expected an email", path: ["email"] }] };
        },
      },
    };
    const codec = wire.standard(LoginSchema);
    expect(codec.kind).toBe("standard(hand-rolled)");
    expect(codec.decode({ email: "a@b.c" })).toEqual({ ok: true, value: { email: "a@b.c" } });
    expect(codec.encode({ email: "nope" })).toEqual({
      ok: false,
      issues: [{ path: ["email"], message: "Expected an email" }],
    });
    // validated values must still survive the wire serializer
    const Hostile: StandardSchemaV1<unknown> = {
      "~standard": { version: 1, vendor: "x", validate: (value) => ({ value }) },
    };
    expect(wire.standard(Hostile).encode(() => undefined).ok).toBe(false);
  });

  test("async schemas are rejected: wire validation is synchronous", () => {
    const AsyncSchema: StandardSchemaV1<string> = {
      "~standard": {
        version: 1,
        vendor: "async",
        validate: async (value) => ({ value: value as string }),
      },
    };
    const result = wire.standard(AsyncSchema).decode("x");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues[0]!.message).toContain("Async schemas");
  });

  test("fieldIssues projects server/bad-request onto dot-joined field paths", () => {
    const failure = ServerBadRequest({
      issues: [
        { path: ["title"], message: "Expected a string" },
        { path: ["title"], message: "Too short" },
        { path: ["author", "email"], message: "Expected an email" },
      ],
    });
    expect(fieldIssues(failure)).toEqual({
      title: ["Expected a string", "Too short"],
      "author.email": ["Expected an email"],
    });
  });
});

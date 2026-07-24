import { describe, expect, test } from "bun:test";
import { ServerBadRequest, ok, rpc, wire } from "./index.js";
import { fieldIssues, toStandardSchema, type StandardSchemaV1 } from "./standard-schema.js";
import { createClient } from "./client/client.js";

describe("forms bridge", () => {
  const RenameInput = wire.object({
    id: wire.string,
    title: wire.string,
  });

  test("a wire codec exposes itself as a Standard Schema with path-scoped issues", () => {
    const schema = toStandardSchema(RenameInput);
    expect(schema["~standard"].vendor).toBe("result-rpc");
    expect(schema["~standard"].version).toBe(1);

    const valid = schema["~standard"].validate({ id: "doc_1", title: "Roadmap" });
    expect(valid).toEqual({ value: { id: "doc_1", title: "Roadmap" } });

    const invalid = schema["~standard"].validate({ id: "doc_1", title: 42 });
    if (!("issues" in invalid) || !invalid.issues) throw new Error("expected issues");
    expect(invalid.issues[0]).toEqual({ message: "Expected a string", path: ["title"] });

    // memoized: form libraries can rely on referential identity
    expect(toStandardSchema(RenameInput)).toBe(schema);
  });

  test("$schema on a client procedure is the input codec's Standard Schema", () => {
    const app = rpc.context<{}>();
    const router = app.router({
      rename: app.procedure()
        .input(RenameInput)
        .output(wire.string)
        .mutation(({ input }) => ok(input.title)),
    });
    const client = createClient({
      router,
      transport: { request: async () => ({ ok: false as const, reason: "network" as const }) },
    });
    const result = client.rename.$schema["~standard"].validate({ id: "x", title: "" });
    expect(result).toEqual({ value: { id: "x", title: "" } });
  });

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

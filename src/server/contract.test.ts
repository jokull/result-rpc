import { describe, expect, test } from "bun:test";
import { err, error, ok, wire } from "../index.js";
import { executeProcedure, rpc } from "./index.js";

interface TestContext {
  readonly authenticated: boolean;
  readonly values: ReadonlyMap<string, string>;
}

const Unauthorized = error({
  tag: "auth/unauthorized",
  data: wire.object({}),
  httpStatus: 401,
  retry: "never",
  visibility: "public",
});

const NotFound = error({
  tag: "value/not-found",
  data: wire.object({ id: wire.string }),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
});

const PrivateFailure = error({
  tag: "value/private-failure",
  data: wire.object({ secret: wire.string }),
  httpStatus: 500,
  retry: "never",
  visibility: "private",
});

const r = rpc.context<TestContext>();

const authenticated = r
  .middleware<{ readonly userId: string }>()
  .errors({ Unauthorized })
  .use(async ({ context, errors, next }) => {
    if (!context.authenticated) return err(errors.Unauthorized({}));
    return next({ context: { ...context, userId: "user_1" } });
  });

const byId = r
  .procedure()
  .use(authenticated)
  .input(wire.object({ id: wire.string }))
  .output(wire.object({ id: wire.string, value: wire.string, ownerId: wire.string }))
  .errors({ NotFound })
  .query(async ({ context, input, errors }) => {
    const value = context.values.get(input.id);
    if (value === undefined) return err(errors.NotFound({ id: input.id }));
    return ok({ id: input.id, value, ownerId: context.userId });
  });

describe("procedure execution", () => {
  test("separates a shared contract from its server implementation", async () => {
    const contract = r
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.object({ id: wire.string, ownerId: wire.string }))
      .errors({ Unauthorized, NotFound })
      .query();
    const publicContract = r.contract({ value: { byId: contract } });
    const implementation = r
      .implement(contract)
      .use(authenticated)
      .handler(({ context, input }) => ok({ id: input.id, ownerId: context.userId }));

    expect(publicContract.procedures.get("value.byId")).toBe(contract);
    const result = await executeProcedure(implementation, { id: "one" }, {
      context: { authenticated: true, values: new Map() },
    });
    expect(result).toEqual({ ok: true, value: { id: "one", ownerId: "user_1" } });
  });

  test("rejects middleware errors absent from a shared contract", () => {
    const contract = r
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .query();

    expect(() => r.implement(contract).use(authenticated))
      .toThrow("is not declared by the procedure contract");
  });

  test("composes middleware context and errors", async () => {
    const result = await executeProcedure(byId, { id: "one" }, {
      context: {
        authenticated: true,
        values: new Map([["one", "value"]]),
      },
    });
    expect(result).toEqual({
      ok: true,
      value: { id: "one", value: "value", ownerId: "user_1" },
    });
  });

  test("returns a declared middleware error", async () => {
    const result = await executeProcedure(byId, { id: "one" }, {
      context: { authenticated: false, values: new Map() },
    });
    expect(result).toEqual({ ok: false, error: Unauthorized({}) });
  });

  test("returns a declared procedure error", async () => {
    const result = await executeProcedure(byId, { id: "missing" }, {
      context: { authenticated: true, values: new Map() },
    });
    expect(result).toEqual({ ok: false, error: NotFound({ id: "missing" }) });
  });

  test("sanitizes thrown defects", async () => {
    const incidents: unknown[] = [];
    const broken = r
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .query(() => {
        throw new Error("database password must not cross the wire");
      });

    const result = await executeProcedure(broken, {}, {
      context: { authenticated: true, values: new Map() },
      onInternalError: (event) => incidents.push(event),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("server/internal");
      expect(JSON.stringify(result)).not.toContain("password");
    }
    expect(incidents).toHaveLength(1);
  });

  test("sanitizes malformed Results returned through an unsafe cast", async () => {
    const malformed = r
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .query(() => null as never);
    const result = await executeProcedure(malformed, {}, {
      context: { authenticated: true, values: new Map() },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("server/internal");
  });

  test("normalizes declared errors before they reach the wire", async () => {
    const forged = r
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .errors({ NotFound })
      .query(() => ({
        ok: false,
        error: {
          _tag: "value/not-found",
          data: { id: "missing" },
          secret: "must not cross",
        },
      }) as never);
    const result = await executeProcedure(forged, {}, {
      context: { authenticated: true, values: new Map() },
    });
    expect(result).toEqual(err(NotFound({ id: "missing" })));
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("converts declared private errors to sanitized internal failures", async () => {
    const privateProcedure = r
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .errors({ PrivateFailure })
      .query(({ errors }) => err(errors.PrivateFailure({ secret: "database detail" })));
    const result = await executeProcedure(privateProcedure, {}, {
      context: { authenticated: true, values: new Map() },
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("database detail");
    if (!result.ok) expect(result.error._tag).toBe("server/internal");
  });

  test("sanitizes custom codec exceptions", async () => {
    const throwing = {
      kind: "throwing",
      encode: () => { throw new Error("codec secret"); },
      decode: () => { throw new Error("codec secret"); },
    } as never;
    const procedure = r
      .procedure()
      .input(throwing)
      .output(wire.string)
      .query(() => ok("unreachable"));
    const result = await executeProcedure(procedure, {}, {
      context: { authenticated: true, values: new Map() },
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("rejects conflicting tag definitions", () => {
    const OtherUnauthorized = error({
      tag: "auth/unauthorized",
      data: wire.object({ reason: wire.string }),
      httpStatus: 403,
      retry: "never",
      visibility: "public",
    });
    expect(() => r.procedure().errors({ Unauthorized }).errors({ OtherUnauthorized }))
      .toThrow("Conflicting definitions");
  });
});

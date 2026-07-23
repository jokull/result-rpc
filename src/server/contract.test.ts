import { describe, expect, test } from "bun:test";
import { deserialize, err, error, ok, serialize, wire } from "../index.js";
import { createFetchHandler, executeProcedure, rpc } from "./index.js";
import { PROTOCOL_CONTENT_TYPE } from "../protocol.js";

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

describe("bad input", () => {
  test("malformed input is a 400 server/bad-request, not an incident", async () => {
    const r = rpc.context<{}>();
    const router = r.router({
      echo: r.procedure()
        .input(wire.object({ id: wire.string }))
        .output(wire.string)
        .query(({ input }) => ok(input.id)),
    });
    const incidents: unknown[] = [];
    const handler = createFetchHandler({
      router,
      createContext: () => ({}),
      onInternalError: (event) => incidents.push(event),
    });
    const envelope = serialize({ v: 1, path: "echo", input: { id: 42 } });
    if (!envelope.ok) throw new Error("unreachable");
    const response = await handler(new Request("https://example.test/rpc", {
      method: "POST",
      headers: { "content-type": PROTOCOL_CONTENT_TYPE },
      body: envelope.value,
    }));
    expect(response.status).toBe(400);
    const decoded = deserialize(await response.text());
    if (!decoded.ok) throw new Error("unreachable");
    const body = decoded.value as { error: { _tag: string; data: { issues: unknown[] } } };
    expect(body.error._tag).toBe("server/bad-request");
    expect(body.error.data.issues.length).toBeGreaterThan(0);
    expect(incidents).toEqual([]); // the client's mistake is not our incident
  });
});

describe("procedure bases", () => {
  test("a base procedure with middleware is reusable across procedures", async () => {
    const r = rpc.context<{ user: string | undefined }>();
    const Denied = error({ tag: "base/denied", httpStatus: 403 });
    const guard = r.middleware<{ viewer: string }>()
      .errors({ Denied })
      .use(({ context, errors, next }) =>
        context.user === undefined
          ? err(errors.Denied())
          : next({ context: { ...context, viewer: context.user } }));

    // the tRPC protectedProcedure pattern: builders are immutable, so a base forks freely
    const protectedProcedure = r.procedure().use(guard);

    const router = r.router({
      whoami: protectedProcedure.output(wire.string).query(({ context }) => ok(context.viewer)),
      shout: protectedProcedure
        .input(wire.object({ word: wire.string }))
        .output(wire.string)
        .query(({ input, context }) => ok(`${context.viewer}: ${input.word}!`)),
    });

    const run = (path: "whoami" | "shout", user: string | undefined, input: unknown) =>
      executeProcedure(router.procedures.get(path)! as never, input as never, {
        context: { user },
      });
    expect(await run("whoami", "u_1", {})).toEqual(ok("u_1"));
    expect(await run("shout", "u_1", { word: "hey" })).toEqual(ok("u_1: hey!"));
    expect(await run("shout", undefined, { word: "hey" }))
      .toEqual(err({ _tag: "base/denied", data: {} }));
  });

  test("onError observes declared errors with their policy", async () => {
    const r = rpc.context<{}>();
    const Missing = error({ tag: "obs/missing", httpStatus: "not-found", severity: "info" });
    const router = r.router({
      find: r.procedure()
        .input(wire.object({ id: wire.string }))
        .output(wire.string)
        .errors({ Missing })
        .query(({ input, errors }) =>
          input.id === "x" ? err(errors.Missing()) : ok(input.id)),
    });
    const seen: { tag: string; status: number; severity?: string }[] = [];
    const handler = createFetchHandler({
      router,
      createContext: () => ({}),
      onError: (event) => seen.push({
        tag: event.error._tag,
        status: event.httpStatus,
        ...(event.policy?.severity === undefined ? {} : { severity: event.policy.severity }),
      }),
    });
    const envelope = serialize({ v: 1, path: "find", input: { id: "x" } });
    if (!envelope.ok) throw new Error("unreachable");
    const response = await handler(new Request("https://example.test/rpc", {
      method: "POST",
      headers: { "content-type": PROTOCOL_CONTENT_TYPE },
      body: envelope.value,
    }));
    expect(response.status).toBe(404);
    expect(seen).toEqual([{ tag: "obs/missing", status: 404, severity: "info" }]);
  });
});

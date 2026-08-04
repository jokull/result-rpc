/**
 * `.headers()` is a capability, so it must survive every builder transition —
 * `.use()` above all, which replaces the context wholesale.
 *
 * Two failures came from that: a procedure lost `context.headers` if it
 * declared `.headers()` *before* `.use()`, making the builder order-dependent;
 * and a header capability arriving through a middleware skipped the kind
 * narrowing, so `.subscription()` typechecked and threw at module init instead.
 */
import { describe, expect, test } from "bun:test";
import { ok, wire } from "../index.js";
import { serverRpc } from "./index.js";
import { createFetchHandler } from "./http.js";
import { PROTOCOL_CONTENT_TYPE, PROTOCOL_VERSION } from "../protocol.js";
import { serialize } from "../serializer.js";

interface Ctx {
  readonly userId: string;
}

const app = serverRpc.context<Ctx>();

const tenant = app
  .middleware<{ tenant: string }>()
  .use(({ context, next }) => next({ context: { ...context, tenant: "acme" } }));

const rotate = app
  .middleware()
  .headers()
  .use(({ context, next }) => {
    context.headers.append("set-cookie", "rotated=1; Path=/");
    return next({ context });
  });

const post = async (
  handler: (request: Request) => Promise<Response>,
  path: string,
): Promise<Response> => {
  const body = serialize({ v: PROTOCOL_VERSION, path, input: {} });
  if (!body.ok) throw new Error("failed to encode the request envelope");
  return handler(
    new Request("https://example.test/rpc", {
      method: "POST",
      headers: { "content-type": PROTOCOL_CONTENT_TYPE },
      body: body.value,
    }),
  );
};

describe("the headers capability across .use()", () => {
  test("survives a middleware applied after .headers()", async () => {
    // The order that used to break. `.use(tenant).headers()` always worked.
    const login = app
      .procedure()
      .headers()
      .use(tenant)
      .output(wire.string)
      .mutation(({ context }) => {
        context.headers.append("set-cookie", `session=${context.userId}; Path=/`);
        return ok(context.tenant);
      });

    const handler = createFetchHandler({
      router: app.router({ login }),
      createContext: () => ({ userId: "u1" }),
    });
    const response = await post(handler, "login");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("session=u1");
  });

  test("survives on the contract-first path too", async () => {
    const contract = app.procedure().headers().output(wire.string).mutation();
    const login = app
      .implement(contract)
      .use(tenant)
      .handler(({ context }) => {
        context.headers.append("set-cookie", "session=contract; Path=/");
        return ok(context.tenant);
      });

    const handler = createFetchHandler({
      router: app.router({ login }),
      createContext: () => ({ userId: "u1" }),
    });
    const response = await post(handler, "login");
    expect(response.headers.get("set-cookie")).toContain("session=contract");
  });

  test("a middleware can contribute the capability, and its write lands", async () => {
    const ping = app
      .procedure()
      .use(rotate)
      .output(wire.string)
      .mutation(({ context }) => {
        // Reachable only because `.use()` re-applied the capability's context.
        context.headers.append("set-cookie", "extra=2; Path=/");
        return ok("ok");
      });

    const handler = createFetchHandler({
      router: app.router({ ping }),
      createContext: () => ({ userId: "u1" }),
    });
    const response = await post(handler, "ping");
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((value) => value.includes("rotated=1"))).toBe(true);
    expect(cookies.some((value) => value.includes("extra=2"))).toBe(true);
  });

  test("a procedure without the capability still has no headers to write", () => {
    // The control: the guard must not hand `headers` to everyone.
    const plain = app
      .procedure()
      .use(tenant)
      .output(wire.string)
      .query(({ context }) => {
        // @ts-expect-error — no .headers() anywhere in this chain.
        const absent: unknown = context.headers;
        return ok(String(absent));
      });
    expect(plain._def.writesHeaders).toBeUndefined();
  });
});

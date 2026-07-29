import { describe, expect, test } from "bun:test";
import { err, error, ok, wire } from "../index.js";
import { createFetchHandler } from "./http.js";
import { rpc, type ErrorDefinitionMap } from "./contract.js";
import { PROTOCOL_CONTENT_TYPE } from "../protocol.js";
import { serialize } from "../serializer.js";

const POISON = "TOP-SECRET-connection-string-9f83a";

const PrivateFailure = error({
  tag: "vault/private",
  data: wire.object({ detail: wire.string }),
  retry: "never",
  visibility: "private",
});

const PublicWithoutStatus = error({
  tag: "value/no-http-status",
});

const StreamDenied = error({
  tag: "stream/denied",
  httpStatus: 401,
});

const r = rpc.context<{}>();

const boom = r
  .procedure()
  .input(wire.object({}))
  .output(wire.object({ ok: wire.boolean }))
  .query(() => {
    // A defect: an unexpected throw carrying a secret in its message.
    throw new Error(`db failed: ${POISON}`);
  });

const leakyPrivate = r
  .procedure()
  .input(wire.object({}))
  .output(wire.object({ ok: wire.boolean }))
  // Deliberately bypass the public contract type to test the runtime backstop.
  .errors({ PrivateFailure } as unknown as ErrorDefinitionMap)
  .query(() => err(PrivateFailure({ detail: POISON })) as never);

const fine = r
  .procedure()
  .input(wire.object({ name: wire.string }))
  .output(wire.object({ name: wire.string }))
  .query(({ input }) => ok({ name: input.name }));

const noHttpStatus = r
  .procedure()
  .output(wire.string)
  .errors({ PublicWithoutStatus })
  .query(() => err(PublicWithoutStatus()));

const deniedStreamContract = r
  .procedure()
  .output(wire.string)
  .errors({ StreamDenied })
  .subscription();
const deniedStream = r.implement(deniedStreamContract).stream(async function* () {
  yield err(StreamDenied());
});

const router = r.router({ boom, leakyPrivate, fine, noHttpStatus, deniedStream });

const post = (path: string, input: unknown) => {
  const encoded = serialize({ v: 1, path, input });
  if (!encoded.ok) throw new Error("failed to encode request envelope");
  return new Request("https://example.test/rpc", {
    method: "POST",
    headers: { "content-type": PROTOCOL_CONTENT_TYPE },
    body: encoded.value,
  });
};

describe("fetch handler wire boundary", () => {
  const handler = createFetchHandler({ router, createContext: () => ({}) });

  test("a defect never leaks its secret onto the wire", async () => {
    const response = await handler(post("boom", {}));
    const text = await response.text();
    // The strongest possible pin: the poison string appears NOWHERE in the
    // raw bytes the client would receive — not the message, not a stack.
    expect(text).not.toContain(POISON);
    expect(text).toContain("server/internal");
    expect(text).toContain("inc_");
    expect(response.status).toBe(500);
  });

  test("a private-visibility error is sanitized to server/internal on the wire", async () => {
    const response = await handler(post("leakyPrivate", {}));
    const text = await response.text();
    // Private errors are composition currency; they must never cross the wire.
    expect(text).not.toContain(POISON);
    expect(text).not.toContain("vault/private");
    expect(text).toContain("server/internal");
    expect(response.status).toBe(500);
  });

  test("a healthy call round-trips through the protocol content type", async () => {
    const response = await handler(post("fine", { name: "ada" }));
    expect(response.headers.get("content-type")).toBe(PROTOCOL_CONTENT_TYPE);
    const text = await response.text();
    expect(text).toContain("ada");
    expect(response.status).toBe(200);
  });

  test("a public error without an HTTP projection uses a neutral 200 envelope", async () => {
    const response = await handler(post("noHttpStatus", {}));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("value/no-http-status");
  });

  test("every response carries the contract digest header", async () => {
    const response = await handler(post("fine", { name: "ada" }));
    expect(response.headers.get("x-result-rpc-contract")).toBeTruthy();
  });

  test("an unknown procedure path is a clean 404, not a defect", async () => {
    const response = await handler(post("nope", {}));
    const text = await response.text();
    expect(response.status).toBe(404);
    expect(text).toContain("procedure-not-found");
    expect(text).not.toContain("inc_");
  });

  test("a declared subscription error reaches onError with its projected status", async () => {
    const observed: Array<{
      readonly tag: string;
      readonly path?: string;
      readonly status: number;
    }> = [];
    const observedHandler = createFetchHandler({
      router,
      createContext: () => ({}),
      onError: ({ error: failure, procedurePath, httpStatus }) =>
        observed.push({
          tag: failure._tag,
          ...(procedurePath === undefined ? {} : { path: procedurePath }),
          status: httpStatus,
        }),
    });
    const response = await observedHandler(post("deniedStream", {}));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("stream/denied");
    expect(observed).toEqual([{ tag: "stream/denied", path: "deniedStream", status: 401 }]);
  });
});

// --- response headers --------------------------------------------------------

// No `headers` in the context type: writing a response header is a declared
// capability, not something every procedure can reach for.
interface HeaderCtx {
  readonly requestId: string;
}
const h = rpc.context<HeaderCtx>();

const login = h
  .procedure()
  .headers()
  .input(wire.object({ email: wire.string }))
  .output(wire.object({ userId: wire.string }))
  .mutation(({ input, context }) => {
    context.headers.append(
      "set-cookie",
      `session=tok_${input.email}; HttpOnly; Path=/; SameSite=Lax`,
    );
    return ok({ userId: "u_1" });
  });

const remember = h
  .procedure()
  .headers()
  .input(wire.object({}))
  .output(wire.boolean)
  .mutation(({ context }) => {
    context.headers.append("set-cookie", "remember=yes; Path=/");
    context.headers.set("cache-control", "no-store");
    return ok(true);
  });

const plain = h
  .procedure()
  .input(wire.object({}))
  .output(wire.string)
  .query(() => ok("ok"));

const headerRouter = h.router({ login, remember, plain });

const headerHandler = createFetchHandler({
  router: headerRouter,
  createContext: () => ({ requestId: "req_1" }),
});

const postTo = (handler: (r: Request) => Promise<Response>, body: unknown) => {
  const encoded = serialize(body);
  if (!encoded.ok) throw new Error("failed to encode");
  return handler(
    new Request("https://example.test/rpc", {
      method: "POST",
      headers: { "content-type": PROTOCOL_CONTENT_TYPE },
      body: encoded.value,
    }),
  );
};

describe("response headers", () => {
  test("a login mutation sets an HttpOnly cookie", async () => {
    const response = await postTo(headerHandler, {
      v: 1,
      path: "login",
      input: { email: "ada@example.com" },
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("session=tok_ada@example.com");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  test("a batch shares one response, so its cookies combine rather than overwrite", async () => {
    const response = await postTo(headerHandler, {
      v: 1,
      batch: [
        { v: 1, id: "b0", path: "login", input: { email: "grace@example.com" } },
        { v: 1, id: "b1", path: "remember", input: {} },
      ],
    });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.some((value) => value.includes("session=tok_grace@example.com"))).toBe(true);
    expect(cookies.some((value) => value.includes("remember=yes"))).toBe(true);
    // Ordinary headers ride along too.
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("a procedure that sets nothing leaves the response untouched", async () => {
    const response = await postTo(headerHandler, { v: 1, path: "plain", input: {} });
    expect(response.headers.get("set-cookie")).toBeNull();
    // The contract digest is still stamped.
    expect(response.headers.get("x-result-rpc-contract")).toBeTruthy();
  });
});

describe("the .headers() declaration", () => {
  test("is recorded on the contract, where a transport can read it", () => {
    // The whole point: batching decisions are made before dispatch, so the
    // fact has to live on the contract rather than in the handler's body.
    expect(login._def.writesHeaders).toBe(true);
    expect(plain._def.writesHeaders).toBeUndefined();
  });

  test("is the only way to reach response headers", () => {
    const undeclared = h
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .query(({ context }) => {
        // @ts-expect-error — no .headers(), so no `headers` on the context.
        const absent: unknown = context.headers;
        return ok(String(absent));
      });
    expect(undeclared._def.writesHeaders).toBeUndefined();
  });

  test("a subscription cannot declare it — its headers are sent before it runs", () => {
    expect(() =>
      rpc.context<HeaderCtx>().procedure().headers().output(wire.string).subscription(),
    ).toThrow(/subscription cannot write response headers/);
  });

  test("a header-writing middleware forces its procedures to declare it too", () => {
    const rotate = h
      .middleware()
      .headers()
      .use(({ context, next }) => {
        context.headers.append("set-cookie", "session=rotated; Path=/");
        return next({ context });
      });

    const contract = h.procedure().output(wire.string).query();
    // @ts-expect-error Header-writing middleware requires a header-capable contract.
    expect(() => h.implement(contract).use(rotate)).toThrow(/must declare \.headers\(\)/);

    // Declared, it composes — and the middleware's write lands.
    const declared = h.procedure().headers().output(wire.string).query();
    expect(() => h.implement(declared).use(rotate)).not.toThrow();
  });

  test("a middleware's write reaches the response", async () => {
    const rotate = h
      .middleware()
      .headers()
      .use(({ context, next }) => {
        context.headers.append("set-cookie", "rotated=1; Path=/");
        return next({ context });
      });
    const contract = h.procedure().headers().output(wire.string).query();
    const rotated = h
      .implement(contract)
      .use(rotate)
      .handler(() => ok("ok"));
    const router = h.router({ rotated });
    const handler = createFetchHandler({
      router,
      createContext: () => ({ requestId: "req_2" }),
    });
    const response = await postTo(handler, { v: 1, path: "rotated", input: {} });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("rotated=1");
  });
});

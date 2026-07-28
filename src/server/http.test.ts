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

const router = r.router({ boom, leakyPrivate, fine, noHttpStatus });

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
});

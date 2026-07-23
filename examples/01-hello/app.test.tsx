import { expect, test } from "bun:test";
import { err, ok } from "../../src/index.js";
import { createClient, fetchTransport } from "../../src/client/index.js";
import { handler, router } from "./app.js";

const localFetch = ((input: string | URL | Request, init?: RequestInit) =>
  handler(new Request(input, init))) as typeof globalThis.fetch;

const client = createClient({
  router,
  transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
});

test("01-hello round-trips success and failure over the wire", async () => {
  expect(await client.greet({ name: "Jokull" })).toEqual(ok("Hello, Jokull!"));
  expect(await client.greet({ name: "nobody" })).toEqual(
    err({ _tag: "greeting/not-found", data: { name: "nobody" } }),
  );
});

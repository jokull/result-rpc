import { describe, expect, test } from "bun:test";
import { ok, rpc, wire } from "../index.js";
import { createClient } from "../client/client.js";
import { fetchTransport } from "../client/transport.js";
import { createFetchHandler } from "./index.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("caller-lifetime signals reach handlers", () => {
  test("a unary handler receives the request's abort signal", async () => {
    const seen: { hasSignal?: boolean; abortedDuring?: boolean } = {};
    const app = rpc.context<{}>();
    const router = app.router({
      slow: app.procedure().input(wire.object({})).output(wire.string)
        .query(async ({ signal }) => {
          seen.hasSignal = signal instanceof AbortSignal;
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener("abort", () => resolve(), { once: true });
            setTimeout(resolve, 2_000);
          });
          seen.abortedDuring = signal.aborted;
          return ok("done");
        }),
    });
    const handler = createFetchHandler({ router, createContext: () => ({}) });
    const client = createClient({
      router,
      transport: fetchTransport({
        url: "https://x.test/rpc",
        fetch: (async (input: string | URL | Request, init?: RequestInit) =>
          handler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const controller = new AbortController();
    const pending = client.slow({}, { signal: controller.signal }).catch(() => undefined);
    await sleep(20);
    controller.abort();
    await pending;
    await sleep(20);
    expect(seen.hasSignal).toBe(true);
    expect(seen.abortedDuring).toBe(true);
  });

  test("a subscription generator's signal aborts and finally runs on client disconnect", async () => {
    const lifecycle: string[] = [];
    const app = rpc.context<{}>();
    const contract = app.procedure().input(wire.object({})).output(wire.string).subscription();
    const events = app.implement(contract).stream(async function* ({ signal }) {
      try {
        yield ok("first");
        // a slow producer awaiting upstream work — must stop with the caller
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => {
            lifecycle.push("signal-aborted");
            resolve();
          }, { once: true });
          setTimeout(resolve, 2_000);
        });
        lifecycle.push("resumed");
        yield ok("second");
      } finally {
        lifecycle.push("finally");
      }
    });
    const router = app.router({ events });
    const handler = createFetchHandler({ router, createContext: () => ({}) });
    const client = createClient({
      router,
      transport: fetchTransport({
        url: "https://x.test/rpc",
        fetch: (async (input: string | URL | Request, init?: RequestInit) =>
          handler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const subscription = client.events({});
    const iterator = subscription[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(!first.done && first.value.ok && first.value.value).toBe("first");
    // the client walks away mid-stream
    subscription.close();
    await sleep(60);
    // the gate resolves on abort (resumed), the producer parks at its next
    // yield, and the framework closes it — finally always runs
    expect(lifecycle).toEqual(["signal-aborted", "resumed", "finally"]);
  });
});

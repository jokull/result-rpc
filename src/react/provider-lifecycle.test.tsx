/**
 * An owned runtime is a side-effect-bearing instance: `createQueryRuntime`
 * mounts a QueryClient, which registers listeners on the module-global
 * focus/online managers. Creating one per render — or per Strict Mode replay —
 * pins that client and its whole cache forever.
 *
 * The listener counts are the observable proxy for "how many QueryClients are
 * currently mounted", which is why they are asserted rather than any internal.
 */
import { describe, expect, test } from "bun:test";
import { StrictMode } from "react";
import { act, create } from "react-test-renderer";
import { focusManager, onlineManager } from "@tanstack/query-core";
import { ok, wire } from "../index.js";
import { createFixtureClient } from "../testing/index.js";
import { fetchTransport } from "../client/transport.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { ResultRpcProvider } from "./index.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const boot = () => {
  const app = rpc.context<{}>();
  const ping = app
    .procedure()
    .output(wire.string)
    .query(() => ok("pong"));
  const router = app.router({ ping });
  const handler = createFetchHandler({ router, createContext: () => ({}) });
  return createFixtureClient({
    router,
    transport: fetchTransport({
      url: "https://probe.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof globalThis.fetch,
    }),
  });
};

// `listeners` is protected on query-core's Subscribable. Reading it is the
// point: it is the only externally observable count of mounted QueryClients,
// and asserting on it is what makes "did we leak one" a fact rather than a
// guess about internals.
const sizeOf = (manager: unknown) =>
  (manager as { readonly listeners: ReadonlySet<unknown> }).listeners.size;
const listeners = () => sizeOf(onlineManager) + sizeOf(focusManager);

const mountAndUnmount = async (strict: boolean) => {
  const client = boot();
  const before = listeners();
  let renderer: ReturnType<typeof create> | undefined;
  const tree = (
    <ResultRpcProvider client={client}>
      <span>ready</span>
    </ResultRpcProvider>
  );
  await act(async () => {
    renderer = create(strict ? <StrictMode>{tree}</StrictMode> : tree);
  });
  const mounted = listeners();
  await act(async () => {
    renderer!.unmount();
  });
  // Disposal is deferred one microtask so a Strict Mode effect replay can
  // cancel it; a real unmount has to survive that window.
  await act(async () => {
    await Promise.resolve();
  });
  return { before, mounted, after: listeners() };
};

describe("provider-owned runtime lifecycle", () => {
  test("unmounting releases the runtime it created", async () => {
    const { before, mounted, after } = await mountAndUnmount(false);
    expect(mounted).toBeGreaterThan(before);
    expect(after).toBe(before);
  });

  test("Strict Mode does not leak a second runtime", async () => {
    // The regression: a double-rendered factory built two QueryClients while
    // cleanup could only ever release the one React retained.
    const { before, after } = await mountAndUnmount(true);
    expect(after).toBe(before);
  });

  test("Strict Mode mounts exactly one runtime, not two", async () => {
    const strict = await mountAndUnmount(true);
    const plain = await mountAndUnmount(false);
    expect(strict.mounted - strict.before).toBe(plain.mounted - plain.before);
  });
});

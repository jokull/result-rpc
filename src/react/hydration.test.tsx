import { describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { ok, wire } from "../index.js";
import { defineModel } from "../model.js";
import { createClient } from "../client/client.js";
import { fetchTransport } from "../client/transport.js";
import { createServerClient } from "../server/server-client.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { createQueryRuntime, type QueryRuntime } from "../query/runtime.js";
import {
  ResultRpcProvider,
  ResultRpcHydrationBoundary,
  useResultQuery,
  useResultMutation,
} from "./index.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const User = defineModel("user", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});

// A shared world: an in-memory store the server reads and writes.
const makeWorld = () => {
  const store = new Map<string, string>([["u_1", "Ada"], ["u_2", "Grace"]]);
  const r = rpc.context<{ store: Map<string, string> }>();
  const getUser = r
    .procedure()
    .input(wire.object({ id: wire.string }))
    .output(User.codec)
    .query(({ input, context }) => ok({ id: input.id, name: context.store.get(input.id) ?? "?" }));
  const rename = r
    .procedure()
    .input(wire.object({ id: wire.string, name: wire.string }))
    .output(User.codec)
    .mutation(({ input, context }) => {
      context.store.set(input.id, input.name);
      return ok({ id: input.id, name: input.name });
    });
  const router = r.router({ getUser, rename });

  // A request-counting handler shared by the server (prefetch) and client.
  let calls = 0;
  const handler = createFetchHandler({ router, createContext: () => ({ store }) });
  const localFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    return handler(new Request(input, init));
  }) as typeof globalThis.fetch;

  const client = createClient({
    router,
    transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
  });
  return { store, router, client, requestCount: () => calls, resetCount: () => { calls = 0; } };
};

// The RSC server phase: a fresh runtime over an in-process server client,
// prefetch, then dehydrate. Mirrors a React.cache'd per-request runtime.
const serverDehydrate = async (
  router: ReturnType<typeof makeWorld>["router"],
  store: Map<string, string>,
  prefetch: (runtime: QueryRuntime, serverClient: any) => Promise<void>,
) => {
  const serverClient = createServerClient(router, { mode: "parity", context: { store } });
  const runtime = createQueryRuntime({ client: serverClient });
  await prefetch(runtime, serverClient);
  const state = runtime.dehydrate();
  runtime.clear();
  return state;
};

describe("RSC hydration boundary", () => {
  test("server-prefetched data renders on first paint with zero client requests", async () => {
    const world = makeWorld();
    const state = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_1" });
    });

    world.resetCount();
    const seen: string[] = [];
    function Detail() {
      const q = useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      seen.push(q.state);
      return q.state === "success"
        ? createElement("span", null, (q.value as { name: string }).name)
        : createElement("span", null, "loading");
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        createElement(
          ResultRpcProvider,
          { client: world.client },
          createElement(
            ResultRpcHydrationBoundary,
            { state },
            createElement(Detail),
          ),
        ),
      );
    });

    // First observed state is already success — no loading flash, no fetch.
    expect(seen[0]).toBe("success");
    expect(seen).not.toContain("pending");
    expect(world.requestCount()).toBe(0);
    act(() => renderer!.unmount());
  });

  test("a client mutation patches a server-hydrated entity at one request", async () => {
    const world = makeWorld();
    const state = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_1" });
    });

    world.resetCount();
    let renameFn: ((input: { id: string; name: string }) => void) | undefined;
    const names: string[] = [];
    function Detail() {
      const q = useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      const m = useResultMutation(world.client.rename);
      renameFn = (input) => void m.mutate(input);
      if (q.state === "success") names.push((q.value as { name: string }).name);
      return createElement("span", null, q.state);
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        createElement(
          ResultRpcProvider,
          { client: world.client },
          createElement(ResultRpcHydrationBoundary, { state }, createElement(Detail)),
        ),
      );
    });
    expect(names[0]).toBe("Ada"); // hydrated, not fetched

    await act(async () => {
      renameFn!({ id: "u_1", name: "Ada Lovelace" });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // The mutation returned a `user` entity; the hydrated query was indexed at
    // hydrate time, so it patched in place. Only the mutation crossed the wire.
    expect(names.at(-1)).toBe("Ada Lovelace");
    expect(world.requestCount()).toBe(1);
    act(() => renderer!.unmount());
  });

  test("nested boundaries merge — each segment's prefetch survives", async () => {
    const world = makeWorld();
    const outer = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_1" });
    });
    const inner = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_2" });
    });

    world.resetCount();
    const states: Record<string, string> = {};
    function One() {
      const q = useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      if (q.state === "success") states.u1 = (q.value as { name: string }).name;
      return createElement("span", null, q.state);
    }
    function Two() {
      const q = useResultQuery(world.client.getUser, { id: "u_2" }, { staleTime: 60_000 });
      if (q.state === "success") states.u2 = (q.value as { name: string }).name;
      return createElement("span", null, q.state);
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        createElement(
          ResultRpcProvider,
          { client: world.client },
          createElement(
            ResultRpcHydrationBoundary,
            { state: outer },
            createElement(One),
            createElement(
              ResultRpcHydrationBoundary,
              { state: inner },
              createElement(Two),
            ),
          ),
        ),
      );
    });

    expect(states.u1).toBe("Ada");
    expect(states.u2).toBe("Grace");
    expect(world.requestCount()).toBe(0);
    act(() => renderer!.unmount());
  });

  test("a version-skewed payload is skipped, not thrown — the client fetches fresh", async () => {
    const world = makeWorld();
    const state = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_1" });
    });
    // Simulate a deploy skew: the server bundle wrote a newer serializer.
    const skewed = { ...state, serializer: state.serializer + 1 } as typeof state;

    world.resetCount();
    const seen: string[] = [];
    function Detail() {
      const q = useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      seen.push(q.state);
      return createElement("span", null, q.state);
    }

    let renderer: ReturnType<typeof create>;
    // Must not throw during render.
    await act(async () => {
      renderer = create(
        createElement(
          ResultRpcProvider,
          { client: world.client },
          createElement(ResultRpcHydrationBoundary, { state: skewed }, createElement(Detail)),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Skipped hydration → started at pending → fetched fresh from the server.
    expect(seen[0]).toBe("pending");
    expect(world.requestCount()).toBe(1);
    act(() => renderer!.unmount());
  });
});

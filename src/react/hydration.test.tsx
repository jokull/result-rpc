import { describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { defineLayer, ok, transportErrors, wire } from "../index.js";
import { defineModel } from "../model.js";
import { fetchTransport } from "../client/transport.js";
import { createServerClient } from "../server/server-client.js";
import { createFetchHandler } from "../server/index.js";
import { createFixtureClient, createParityClient } from "../testing/index.js";
import { rpc } from "../server/contract.js";
import { createQueryRuntime, type QueryRuntime } from "../query/runtime.js";
import {
  ResultRpcProvider,
  ResultRpcHydrationBoundary,
  createResultRpcReact,
  defineShell,
  prefetchLayer,
  useResultQuery,
  useResultMutation,
} from "./index.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const User = defineModel("user", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});

const ViewerLayer = defineLayer({
  name: "rsc-viewer",
  key: "viewer",
  provides: User.all("RSC layer fixture"),
  errors: {},
});

const RscRootShell = defineShell({
  name: "rsc-root",
  claims: transportErrors,
});

// A shared world: an in-memory store the server reads and writes.
const makeWorld = () => {
  const store = new Map<string, string>([
    ["u_1", "Ada"],
    ["u_2", "Grace"],
  ]);
  const r = rpc.context<{ store: Map<string, string> }>();
  const getUser = r
    .procedure()
    .input(wire.object({ id: wire.string }))
    .output(User.all("test fixture"))
    .query(({ input, context }) => ok({ id: input.id, name: context.store.get(input.id) ?? "?" }));
  const rename = r
    .procedure()
    .input(wire.object({ id: wire.string, name: wire.string }))
    .output(User.all("test fixture"))
    .mutation(({ input, context }) => {
      context.store.set(input.id, input.name);
      return ok({ id: input.id, name: input.name });
    });
  const viewerMiddleware = ViewerLayer.middleware(r, ({ context }) =>
    ok({ id: "u_1", name: context.store.get("u_1") ?? "?" }),
  );
  const viewer = ViewerLayer.procedure(r, viewerMiddleware);
  const router = r.router({ getUser, rename, viewer });

  // A request-counting handler shared by the server (prefetch) and client.
  let calls = 0;
  const handler = createFetchHandler({ router, createContext: () => ({ store }) });
  const localFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    return handler(new Request(input, init));
  }) as typeof globalThis.fetch;

  const client = createFixtureClient({
    router,
    transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
  });
  return {
    store,
    router,
    client,
    requestCount: () => calls,
    resetCount: () => {
      calls = 0;
    },
  };
};

// React reports a store update issued from inside another component's render.
const RENDER_PHASE_UPDATE = "Cannot update a component";
const captureConsoleErrors = () => {
  const calls: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    calls.push(args.map(String).join(" "));
  };
  return {
    renderPhaseUpdates: () => calls.filter((call) => call.includes(RENDER_PHASE_UPDATE)),
    restore: () => {
      console.error = original;
    },
  };
};

// The RSC server phase: a fresh runtime over an in-process server client,
// prefetch, then dehydrate. Mirrors a React.cache'd per-request runtime.
const serverDehydrate = async (
  router: ReturnType<typeof makeWorld>["router"],
  store: Map<string, string>,
  prefetch: (runtime: QueryRuntime, serverClient: any) => Promise<void>,
) => {
  const serverClient = createParityClient(router, { context: { store } });
  const runtime = createQueryRuntime({ client: serverClient });
  await prefetch(runtime, serverClient);
  const state = runtime.dehydrate();
  runtime.clear();
  return state;
};

describe("RSC hydration boundary", () => {
  test("a decodable cache from a different contract is skipped and fetched fresh", async () => {
    const oldRpc = rpc.context<{}>();
    const oldValue = oldRpc
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .query(() => ok("OLD-BUNDLE"));
    const removedInCurrentBuild = oldRpc
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .query(() => ok("removed"));
    const oldRouter = oldRpc.router({ value: oldValue, removedInCurrentBuild });

    const currentRpc = rpc.context<{}>();
    const currentValue = currentRpc
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .query(() => ok("CURRENT-BUNDLE"));
    const currentRouter = currentRpc.router({ value: currentValue });

    const serverClient = createServerClient(oldRouter, { context: {} });
    const serverRuntime = createQueryRuntime({ client: serverClient });
    await serverRuntime.prefetch(serverClient.value, {});
    const state = serverRuntime.dehydrate();
    serverRuntime.clear();

    let requests = 0;
    const currentHandler = createFetchHandler({
      router: currentRouter,
      createContext: () => ({}),
    });
    const currentFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests += 1;
      return currentHandler(new Request(input, init));
    }) as typeof globalThis.fetch;
    const currentClient = createFixtureClient({
      router: currentRouter,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: currentFetch }),
    });

    const seen: string[] = [];
    function Detail() {
      const query = useResultQuery(currentClient.value, {}, { staleTime: 60_000 });
      if (query.state === "success") seen.push(query.value);
      return createElement("span", null, query.state);
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        createElement(
          ResultRpcProvider,
          { client: currentClient },
          createElement(ResultRpcHydrationBoundary, { state }, createElement(Detail)),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(seen).not.toContain("OLD-BUNDLE");
    expect(seen.at(-1)).toBe("CURRENT-BUNDLE");
    expect(requests).toBe(1);
    act(() => renderer!.unmount());
  });

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
          createElement(ResultRpcHydrationBoundary, { state }, createElement(Detail)),
        ),
      );
    });

    // First observed state is already success — no loading flash, no fetch.
    expect(seen[0]).toBe("success");
    expect(seen).not.toContain("pending");
    expect(world.requestCount()).toBe(0);
    act(() => renderer!.unmount());
  });

  test("observing a cached success during render does not update sibling observers", async () => {
    const world = makeWorld();
    const runtime = createQueryRuntime({ client: world.client });
    await runtime.prefetch(world.client.getUser, { id: "u_1" });

    function FirstObserver() {
      useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      return createElement("span", null, "first");
    }

    function SecondObserver() {
      useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      return createElement("span", null, "second");
    }

    function App({ second }: { second: boolean }) {
      return createElement(
        "div",
        null,
        createElement(FirstObserver),
        second ? createElement(SecondObserver) : null,
      );
    }

    const calls: unknown[][] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => calls.push(args);
    try {
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(
          createElement(ResultRpcProvider, { runtime }, createElement(App, { second: false })),
        );
      });
      await act(async () => {
        renderer!.update(
          createElement(ResultRpcProvider, { runtime }, createElement(App, { second: true })),
        );
      });

      expect(calls.some((args) => String(args[0]).includes("Cannot update a component"))).toBe(
        false,
      );
      act(() => renderer!.unmount());
    } finally {
      console.error = consoleError;
      runtime.clear();
    }
  });

  test("a boundary mounted later hydrates a new key without updating a sibling mid-render", async () => {
    const world = makeWorld();
    const stateA = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_1" });
    });
    const stateB = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_2" });
    });
    const runtime = createQueryRuntime({ client: world.client });

    const bStates: string[] = [];
    function ObserveA() {
      const q = useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      return createElement("span", null, q.state);
    }
    function ObserveB() {
      const q = useResultQuery(world.client.getUser, { id: "u_2" }, { staleTime: 60_000 });
      bStates.push(q.state);
      return createElement("span", null, q.state);
    }
    function App({ second }: { second: boolean }) {
      return createElement(
        ResultRpcProvider,
        { runtime },
        createElement(ResultRpcHydrationBoundary, { state: stateA }, createElement(ObserveA)),
        second
          ? createElement(ResultRpcHydrationBoundary, { state: stateB }, createElement(ObserveB))
          : null,
      );
    }

    world.resetCount();
    const errors = captureConsoleErrors();
    try {
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(createElement(App, { second: false }));
      });
      await act(async () => {
        renderer!.update(createElement(App, { second: true }));
      });
      expect(errors.renderPhaseUpdates()).toEqual([]);
      // The new key was unknown to the cache, so it still hydrated in render:
      // first paint is success, with no fetch.
      expect(bStates[0]).toBe("success");
      expect(world.requestCount()).toBe(0);
      act(() => renderer!.unmount());
    } finally {
      errors.restore();
      runtime.clear();
    }
  });

  test("a boundary mounted later with newer data for an observed key applies after commit", async () => {
    const world = makeWorld();
    const first = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_1" });
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    world.store.set("u_1", "Ada Lovelace");
    const newer = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_1" });
    });
    const runtime = createQueryRuntime({ client: world.client });

    const names: string[] = [];
    function Detail() {
      const q = useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      if (q.state === "success") names.push((q.value as { name: string }).name);
      return createElement("span", null, q.state);
    }
    function App({ second }: { second: boolean }) {
      return createElement(
        ResultRpcProvider,
        { runtime },
        createElement(ResultRpcHydrationBoundary, { state: first }, createElement(Detail)),
        second ? createElement(ResultRpcHydrationBoundary, { state: newer }) : null,
      );
    }

    world.resetCount();
    const errors = captureConsoleErrors();
    try {
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(createElement(App, { second: false }));
      });
      expect(names.at(-1)).toBe("Ada");
      await act(async () => {
        renderer!.update(createElement(App, { second: true }));
      });
      // The key already existed (and was observed), so the write waited for
      // commit — the observer still received the newer server data, and
      // nothing was fetched.
      expect(errors.renderPhaseUpdates()).toEqual([]);
      expect(names.at(-1)).toBe("Ada Lovelace");
      expect(world.requestCount()).toBe(0);
      act(() => renderer!.unmount());
    } finally {
      errors.restore();
      runtime.clear();
    }
  });

  test("a provider whose hydrate prop changes identity does not update observers mid-render", async () => {
    const world = makeWorld();
    const stateA = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_1" });
    });
    const stateB = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_2" });
    });
    const runtime = createQueryRuntime({ client: world.client });

    function ObserveA() {
      const q = useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      return createElement("span", null, q.state);
    }

    const errors = captureConsoleErrors();
    try {
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(
          createElement(ResultRpcProvider, { runtime, hydrate: stateA }, createElement(ObserveA)),
        );
      });
      await act(async () => {
        renderer!.update(
          createElement(ResultRpcProvider, { runtime, hydrate: stateB }, createElement(ObserveA)),
        );
      });
      expect(errors.renderPhaseUpdates()).toEqual([]);
      expect(runtime.cache.get(world.client.getUser, { id: "u_2" })).toMatchObject({
        name: "Grace",
      });
      act(() => renderer!.unmount());
    } finally {
      errors.restore();
      runtime.clear();
    }
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
      renameFn = (input) => void m.mutateAsync(input);
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
            createElement(ResultRpcHydrationBoundary, { state: inner }, createElement(Two)),
          ),
        ),
      );
    });

    expect(states.u1).toBe("Ada");
    expect(states.u2).toBe("Grace");
    expect(world.requestCount()).toBe(0);
    act(() => renderer!.unmount());
  });

  test("nested boundaries accept matching state and independently skip a mismatched segment", async () => {
    const world = makeWorld();
    const matching = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_1" });
    });
    const inner = await serverDehydrate(world.router, world.store, async (runtime, sc) => {
      await runtime.prefetch(sc.getUser, { id: "u_2" });
    });
    const mismatched = { ...inner, contract: `${inner.contract}-other-build` };

    world.resetCount();
    const oneStates: string[] = [];
    const twoStates: string[] = [];
    function One() {
      const query = useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      oneStates.push(query.state);
      return createElement("span", null, query.state);
    }
    function Two() {
      const query = useResultQuery(world.client.getUser, { id: "u_2" }, { staleTime: 60_000 });
      twoStates.push(query.state);
      return createElement("span", null, query.state);
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        createElement(
          ResultRpcProvider,
          { client: world.client },
          createElement(
            ResultRpcHydrationBoundary,
            { state: matching },
            createElement(One),
            createElement(ResultRpcHydrationBoundary, { state: mismatched }, createElement(Two)),
          ),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(oneStates[0]).toBe("success");
    expect(twoStates[0]).toBe("pending");
    expect(twoStates.at(-1)).toBe("success");
    expect(world.requestCount()).toBe(1);
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

describe("direct server caller", () => {
  test("prefetches and dehydrates for RSC without touching the wire", async () => {
    const world = makeWorld();
    // Direct — no serializer, no HTTP envelope, no contract digest.
    const caller = createServerClient(world.router, {
      context: { store: world.store },
    });
    const runtime = createQueryRuntime({ client: caller });
    const prefetched = await runtime.prefetch(caller.getUser, { id: "u_1" });
    expect(prefetched.isOk()).toBe(true);
    const state = runtime.dehydrate();
    runtime.clear();

    world.resetCount();
    const seen: string[] = [];
    function Detail() {
      const q = useResultQuery(world.client.getUser, { id: "u_1" }, { staleTime: 60_000 });
      seen.push(q.state);
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

    // Server-rendered on first paint, and the browser made no request.
    expect(seen[0]).toBe("success");
    expect(world.requestCount()).toBe(0);
    act(() => renderer!.unmount());
  });

  test("a layer context procedure prefetches in RSC and establishes without a browser request", async () => {
    const world = makeWorld();
    const caller = createServerClient(world.router, {
      context: { store: world.store },
    });
    const serverRuntime = createQueryRuntime({ client: caller });
    const serverReact = createResultRpcReact<typeof caller>();
    const ServerViewerShell = serverReact.layerShell(ViewerLayer, {
      from: RscRootShell,
      procedure: caller.viewer,
    });
    const prefetched = await prefetchLayer(serverRuntime, ServerViewerShell, caller);
    expect(prefetched.isOk()).toBe(true);
    const state = serverRuntime.dehydrate();
    serverRuntime.clear();

    const browserReact = createResultRpcReact<typeof world.client>();
    const BrowserViewerShell = browserReact.layerShell(ViewerLayer, {
      from: RscRootShell,
      procedure: world.client.viewer,
      load: { staleTime: 60_000 },
    });
    world.resetCount();
    const seen: string[] = [];
    function Detail() {
      seen.push(BrowserViewerShell.use().name);
      return createElement("span", null, seen.at(-1));
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        createElement(
          browserReact.ResultRpcProvider,
          { client: world.client },
          createElement(
            ResultRpcHydrationBoundary,
            { state },
            createElement(
              RscRootShell.Provider,
              null,
              createElement(
                BrowserViewerShell.Provider,
                { fallback: createElement("span", null, "loading") },
                createElement(Detail),
              ),
            ),
          ),
        ),
      );
    });

    expect(seen[0]).toBe("Ada");
    expect(world.requestCount()).toBe(0);
    act(() => renderer!.unmount());
  });
});

import { describe, expect, test } from "bun:test";
import { Component, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { err, error, ok, wire } from "../index.js";
import { createClient } from "../client/client.js";
import { fetchTransport, type ClientTransport } from "../client/transport.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { boundaryShells } from "./boundary.js";
import { createQueryRuntime } from "../query/runtime.js";
import { ResultRpcProvider } from "./index.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const Gone = error({ tag: "boundary-test/gone", httpStatus: 410 });

/** A v2 server whose contract digest no longer matches the stale client's. */
const makeSkewedPair = () => {
  const server = rpc.context<{}>();
  const serverRouter = server.router({
    thing: server.procedure()
      .input(wire.object({ id: wire.string, revision: wire.number }))
      .output(wire.string)
      .errors({ Gone })
      .query(({ input }) => input.id === "gone"
        ? err(Gone())
        : ok(`${input.id}@${input.revision}`)),
  });
  const handler = createFetchHandler({ router: serverRouter, createContext: () => ({}) });

  const stale = rpc.context<{}>();
  const staleRouter = stale.router({
    thing: stale.procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .query(({ input }) => ok(input.id)),
  });
  const client = createClient({
    router: staleRouter,
    transport: fetchTransport({
      url: "https://example.test/rpc",
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof globalThis.fetch,
    }),
  });
  return client;
};

class CatchAll extends Component<{ children?: ReactNode }, { caught?: unknown }> {
  override state: { caught?: unknown } = {};
  static getDerivedStateFromError(caught: unknown) {
    return { caught };
  }
  override render() {
    if (this.state.caught === undefined) return this.props.children;
    return <p>boundary: {(this.state.caught as { _tag?: string })._tag}</p>;
  }
}

describe("boundaryShells", () => {
  test("a stale deploy is claimed by StaleShell and triggers the stale reaction, not a failure state", async () => {
    const client = makeSkewedPair();
    const staleReactions: string[] = [];
    const { StaleShell, BoundaryProvider } = boundaryShells({
      name: "test-a",
      onStale: (failure) => void staleReactions.push(failure.data.reclassifiedFrom),
    });

    function Probe() {
      const state = StaleShell.useQuery(
        (client as { thing: never }).thing,
        { id: "a" } as never,
      );
      return <p>state:{(state as { state: string }).state}</p>;
    }

    let renderer: ReactTestRenderer | undefined;
    const runtime = createQueryRuntime({ client });
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <BoundaryProvider>
            <Probe />
          </BoundaryProvider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    const html = JSON.stringify(renderer!.toJSON());
    // claimed, so the operation pauses instead of surfacing failure
    expect(html).toContain("state:");
    expect(html).not.toContain("state:failure");
    expect(staleReactions).toEqual(["server/bad-request"]);
    await act(async () => renderer!.unmount());
    runtime.clear();
  });

  test("held stale work is visible on the shell aggregate", async () => {
    const client = makeSkewedPair();
    const { StaleShell, BoundaryProvider } = boundaryShells({
      name: "test-b",
      onStale: () => undefined, // a real app reloads; tests observe instead
    });

    let held: { latest?: { _tag: string } } = {};
    function Probe() {
      void StaleShell.useQuery((client as { thing: never }).thing, { id: "a" } as never);
      held = StaleShell.useHeld() as typeof held;
      return null;
    }

    const runtime = createQueryRuntime({ client });
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <BoundaryProvider>
            <CatchAll>
              <Probe />
            </CatchAll>
          </BoundaryProvider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(held.latest?._tag).toBe("client/stale");
    await act(async () => renderer!.unmount());
    runtime.clear();
  });

  test("reconnect resumes held transport failures automatically", async () => {
    const app = rpc.context<{}>();
    const router = app.router({
      ping: app.procedure().input(wire.object({})).output(wire.string)
        .query(() => ok("pong")),
    });
    const handler = createFetchHandler({ router, createContext: () => ({}) });
    const local = fetchTransport({
      url: "https://example.test/rpc",
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof globalThis.fetch,
    });
    let offline = true;
    const transport: ClientTransport = {
      request: async (...args) => offline
        ? { ok: false, reason: "offline" }
        : local.request(...args),
    };
    const client = createClient({ router, transport });
    const { TransportShell, BoundaryProvider, useConnectivity } =
      boundaryShells({ name: "test-c" });

    let status: string | undefined;
    function Probe() {
      const state = TransportShell.useQuery(client.ping, {}, { retry: false });
      status = useConnectivity().status;
      return <p>state:{state.state}</p>;
    }

    const runtime = createQueryRuntime({ client });
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <BoundaryProvider>
            <Probe />
          </BoundaryProvider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    // claimed and held: the browser still claims online, so this is "degraded"
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("failure");
    expect(status).toBe("degraded");

    offline = false;
    await act(async () => {
      globalThis.dispatchEvent(new Event("online"));
      await settle();
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain("success");
    expect(status).toBe("online");
    await act(async () => renderer!.unmount());
    runtime.clear();
  });

  test("useConnectivity tracks the browser's own offline claim", async () => {
    const app = rpc.context<{}>();
    const router = app.router({
      ping: app.procedure().input(wire.object({})).output(wire.string)
        .query(() => ok("pong")),
    });
    const handler = createFetchHandler({ router, createContext: () => ({}) });
    const client = createClient({
      router,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const { BoundaryProvider, useConnectivity } = boundaryShells({ name: "test-d" });

    let net: { status: string; online: boolean } | undefined;
    function Probe() {
      net = useConnectivity();
      return null;
    }

    const runtime = createQueryRuntime({ client });
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <BoundaryProvider>
            <Probe />
          </BoundaryProvider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(net!.status).toBe("online");
    expect(net!.online).toBe(true);

    await act(async () => {
      globalThis.dispatchEvent(new Event("offline"));
    });
    expect(net!.status).toBe("offline");
    expect(net!.online).toBe(false);

    await act(async () => {
      globalThis.dispatchEvent(new Event("online"));
    });
    expect(net!.status).toBe("online");
    await act(async () => renderer!.unmount());
    runtime.clear();
  });

  test("a mutation held offline drains on reconnect without being replayed", async () => {
    const app = rpc.context<{}>();
    const router = app.router({
      save: app.procedure().input(wire.object({ note: wire.string })).output(wire.string)
        .mutation(({ input }) => ok(input.note)),
    });
    let attempts = 0;
    const transport: ClientTransport = {
      request: async () => {
        attempts += 1;
        return { ok: false, reason: "offline" };
      },
    };
    const client = createClient({ router, transport });
    const { TransportShell, BoundaryProvider, useConnectivity } =
      boundaryShells({ name: "test-e" });

    let net: { status: string; held: number } | undefined;
    let mutationState: { mutate: (input: { note: string }) => Promise<unknown>; state: string } | undefined;
    function Probe() {
      mutationState = TransportShell.useMutation(client.save, { retry: false }) as never;
      net = useConnectivity();
      return null;
    }

    const runtime = createQueryRuntime({ client });
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          <ResultRpcProvider runtime={runtime}>
            <BoundaryProvider>
              <Probe />
            </BoundaryProvider>
          </ResultRpcProvider>,
        );
        await settle();
      });
      await act(async () => {
        await mutationState!.mutate({ note: "while offline" }).catch(() => undefined);
        await settle();
      });
      // claimed and held: projects idle, banner shows degraded with one waiting
      expect(mutationState?.state).toBe("idle");
      expect(net?.status).toBe("degraded");
      expect(net?.held).toBe(1);
      expect(attempts).toBe(1);

      await act(async () => {
        globalThis.dispatchEvent(new Event("online"));
        await settle();
      });
      // the arc ends: holdings drain, banner clears — and the side effect
      // was NOT fired again
      expect(net?.held).toBe(0);
      expect(net?.status).toBe("online");
      expect(attempts).toBe(1);
      await act(async () => renderer!.unmount());
    } finally {
      globalThis.dispatchEvent(new Event("online"));
      runtime.clear();
    }
  });
});

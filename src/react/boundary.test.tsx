import { describe, expect, test } from "bun:test";
import { Component, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { err, error, ok, wire } from "../index.js";
import { createClient } from "../client/client.js";
import { fetchTransport } from "../client/transport.js";
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
});

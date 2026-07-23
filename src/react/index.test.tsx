import { describe, expect, test } from "bun:test";
import { Suspense } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { err, error, ok, wire } from "../index.js";
import { createClient } from "../client/client.js";
import { fetchTransport, isCancelled, isClaimed } from "../client/transport.js";
import { defineShell } from "./shell.js";
import { createQueryRuntime, type MutationState, type QueryState, type SubscriptionState } from "../query/runtime.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import type { ClientBoundaryError, ServerBadRequest, ServerInternal } from "../framework-errors.js";
import {
  ResultRpcProvider,
  useResultMutation,
  useResultQuery,
  useResultSubscription,
  useResultSuspenseQuery,
} from "./index.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const r = rpc.context<{}>();
const value = r.procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .query(({ input }) => ok(input.id));
const SessionExpired = error({ tag: "session/expired", httpStatus: 401 });
const rename = r.procedure()
  .input(wire.object({ title: wire.string }))
  .output(wire.string)
  .errors({ SessionExpired })
  .mutation(({ input }) => input.title === "expired"
    ? err(SessionExpired())
    : ok(input.title));
const eventContract = r.procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .subscription();
const events = r.implement(eventContract).stream(async function* ({ input }) {
  yield ok(`event:${input.id}`);
});
const router = r.router({ demo: { value, rename, events } });
const handler = createFetchHandler({ router, createContext: () => ({}) });
const localFetch = ((input: string | URL | Request, init?: RequestInit) =>
  handler(new Request(input, init))) as typeof globalThis.fetch;
const client = createClient({
  router,
  transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
});
type FrameworkFailure = ServerInternal | ServerBadRequest | ClientBoundaryError;
type RenameFailure = FrameworkFailure | ReturnType<typeof SessionExpired>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("React bindings", () => {
  test("mounts query and mutation hooks over the Result state", async () => {
    const runtime = createQueryRuntime({ client });
    let queryState: QueryState<string, FrameworkFailure> | undefined;
    let mutationState: MutationState<{ readonly title: string }, string, RenameFailure> | undefined;

    function Probe() {
      queryState = useResultQuery(client.demo.value, { id: "one" });
      mutationState = useResultMutation(client.demo.rename);
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<ResultRpcProvider runtime={runtime}><Probe /></ResultRpcProvider>);
      await settle();
    });
    expect(queryState?.state).toBe("success");
    await act(async () => {
      await mutationState!.mutate({ title: "renamed" });
    });
    expect(mutationState?.state).toBe("success");
    expect(mutationState?.result).toEqual(ok("renamed"));
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a shell-claimed mutation rejects with the claimed signal, not cancellation", async () => {
    const SessionShell = defineShell({ name: "session-owner", claims: { SessionExpired } });
    const runtime = createQueryRuntime({ client });
    let mutationState: MutationState<{ readonly title: string }, string, RenameFailure> | undefined;

    function Probe() {
      mutationState = SessionShell.useMutation(client.demo.rename) as typeof mutationState;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <SessionShell.Provider><Probe /></SessionShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    let rejection: unknown;
    await act(async () => {
      await mutationState!.mutate({ title: "expired" }).catch((reason: unknown) => {
        rejection = reason;
      });
      await settle();
    });
    expect(isClaimed(rejection)).toBe(true);
    expect(isCancelled(rejection)).toBe(false);
    if (!isClaimed(rejection)) throw new Error("unreachable");
    expect(rejection.data).toEqual({ tag: "session/expired", owner: "session-owner" });
    // the outcome is owned above: the mutation projects idle, not failure
    expect(mutationState?.state).toBe("idle");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("mounts subscription and Suspense projections", async () => {
    const runtime = createQueryRuntime({ client });
    let subscriptionState: SubscriptionState<string, FrameworkFailure> | undefined;

    function SubscriptionProbe() {
      subscriptionState = useResultSubscription(client.demo.events, { id: "one" });
      return null;
    }
    function SuspenseProbe() {
      const state = useResultSuspenseQuery(client.demo.value, { id: "suspense" });
      return <span>{state.result.ok ? state.result.value : state.result.error._tag}</span>;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <SubscriptionProbe />
          <Suspense fallback={<span>loading</span>}><SuspenseProbe /></Suspense>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(subscriptionState?.connection).toBe("closed");
    expect(subscriptionState?.result).toEqual(ok("event:one"));
    expect(JSON.stringify(renderer?.toJSON())).toContain("suspense");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });
});

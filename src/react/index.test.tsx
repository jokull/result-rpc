import { describe, expect, test } from "bun:test";
import { Component, StrictMode, Suspense, useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { err, error, ok, wire, type Result } from "../index.js";
import { createFixtureClient } from "../testing/index.js";
import { fetchTransport, isCancelled, isClaimed } from "../client/transport.js";
import { defineShell } from "./shell.js";
import {
  type MutationState,
  type PaginatedState,
  type QueryRuntime,
  type QueryState,
  type SubscriptionState,
} from "../query/runtime.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import type { ClientBoundaryError, ServerBadRequest, ServerInternal } from "../framework-errors.js";
import {
  ResultRpcProvider,
  useResultMutation,
  useResultPaginatedQuery,
  useResultQuery,
  useResultRuntime,
  useResultSubscription,
  useResultSuspenseQuery,
} from "./index.js";
import { createQueryRuntime } from "../query/runtime.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const r = rpc.context<{}>();
const value = r
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .query(({ input }) => ok(input.id));
const SessionExpired = error({ tag: "session/expired", httpStatus: 401 });
const SessionRefreshing = error({
  tag: "session/refreshing",
  data: wire.object({ retryAfterMs: wire.number }),
  retry: "after",
  httpStatus: 401,
});
const TitleConflict = error({ tag: "doc/title-conflict", httpStatus: 409 });
const TemporaryConflict = error({
  tag: "doc/temporary-conflict",
  data: wire.object({ retryAfterMs: wire.number }),
  retry: "after",
  httpStatus: 409,
});
const renameAttempts = new Map<string, number>();
const rename = r
  .procedure()
  .input(wire.object({ title: wire.string }))
  .output(wire.string)
  .errors({ SessionExpired, SessionRefreshing, TitleConflict, TemporaryConflict })
  .mutation(({ input }) => {
    renameAttempts.set(input.title, (renameAttempts.get(input.title) ?? 0) + 1);
    if (input.title === "expired") return err(SessionExpired());
    if (input.title === "refreshing") {
      return err(SessionRefreshing({ retryAfterMs: 0 }));
    }
    if (input.title === "conflict") return err(TitleConflict());
    if (input.title === "temporary") {
      return err(TemporaryConflict({ retryAfterMs: 0 }));
    }
    return ok(input.title);
  });
const eventContract = r
  .procedure()
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
const client = createFixtureClient({
  router,
  transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
});
type FrameworkFailure = ServerInternal | ServerBadRequest | ClientBoundaryError;
type RenameFailure =
  | FrameworkFailure
  | ReturnType<typeof SessionExpired>
  | ReturnType<typeof SessionRefreshing>
  | ReturnType<typeof TitleConflict>
  | ReturnType<typeof TemporaryConflict>;
type ResidualRenameFailure =
  | FrameworkFailure
  | ReturnType<typeof SessionRefreshing>
  | ReturnType<typeof TitleConflict>
  | ReturnType<typeof TemporaryConflict>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

class TestBoundary extends Component<
  { readonly children?: ReactNode; readonly onCaught: (error: unknown) => void },
  { readonly caught?: unknown }
> {
  override state: { readonly caught?: unknown } = {};
  static getDerivedStateFromError(caught: unknown) {
    return { caught };
  }
  override componentDidCatch(caught: unknown) {
    this.props.onCaught(caught);
  }
  override render() {
    return this.state.caught === undefined ? this.props.children : null;
  }
}

describe("React bindings", () => {
  test("provider ownership clears only owned runtimes across Strict replay and client replacement", async () => {
    const secondClient = createFixtureClient({
      router,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
    });
    const clears = new Map<QueryRuntime<unknown>, number>();
    const captured: QueryRuntime<unknown>[] = [];

    function CaptureOwned() {
      const runtime = useResultRuntime();
      if (!clears.has(runtime)) {
        clears.set(runtime, 0);
        const clear = runtime.clear;
        Reflect.set(runtime, "clear", () => {
          clears.set(runtime, (clears.get(runtime) ?? 0) + 1);
          clear();
        });
        captured.push(runtime);
      }
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <StrictMode>
          <ResultRpcProvider client={client}>
            <CaptureOwned />
          </ResultRpcProvider>
        </StrictMode>,
      );
      await settle();
    });
    expect(captured).toHaveLength(1);
    expect(clears.get(captured[0]!)).toBe(0);

    await act(async () => {
      renderer?.update(
        <StrictMode>
          <ResultRpcProvider client={secondClient}>
            <CaptureOwned />
          </ResultRpcProvider>
        </StrictMode>,
      );
      await settle();
    });
    expect(captured).toHaveLength(2);
    expect(captured[0]).not.toBe(captured[1]);
    expect(clears.get(captured[0]!)).toBe(1);
    expect(clears.get(captured[1]!)).toBe(0);

    await act(async () => {
      renderer?.unmount();
      await settle();
    });
    expect(clears.get(captured[0]!)).toBe(1);
    expect(clears.get(captured[1]!)).toBe(1);

    const borrowed = createQueryRuntime({ client });
    let borrowedClears = 0;
    const clearBorrowed = borrowed.clear;
    Reflect.set(borrowed, "clear", () => {
      borrowedClears += 1;
      clearBorrowed();
    });
    await act(async () => {
      renderer = create(
        <StrictMode>
          <ResultRpcProvider runtime={borrowed}>
            <CaptureOwned />
          </ResultRpcProvider>
        </StrictMode>,
      );
      await settle();
      renderer.unmount();
      await settle();
    });
    expect(borrowedClears).toBe(0);
    borrowed.clear();
    expect(borrowedClears).toBe(1);
  });

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
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <Probe />
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(queryState?.state).toBe("success");
    await act(async () => {
      await mutationState!.mutateAsync({ title: "renamed" });
    });
    expect(mutationState?.state).toBe("success");
    expect(mutationState?.value).toBe("renamed");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a shell-claimed mutation rejects with the claimed signal, not cancellation", async () => {
    const SessionShell = defineShell({ name: "session-owner", claims: { SessionExpired } });
    const runtime = createQueryRuntime({ client });
    const failures: RenameFailure[] = [];
    const settled: Result<string, RenameFailure>[] = [];
    const controls: string[] = [];
    const retryCalls: number[] = [];
    let optimisticValue = "original";
    let mutationState:
      | MutationState<{ readonly title: string }, string, ResidualRenameFailure>
      | undefined;

    function Probe() {
      mutationState = SessionShell.useMutation(client.demo.rename, {
        optimistic: ({ title }) => {
          const previous = optimisticValue;
          optimisticValue = title;
          return { rollback: () => (optimisticValue = previous) };
        },
        retry: (_failure, count) => {
          retryCalls.push(count);
          return true;
        },
        onFailure: (failure) => void failures.push(failure),
        onSettled: (result) => void settled.push(result),
        onCancel: (_input, context) => {
          controls.push("cleanup");
          context?.rollback();
        },
      });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <SessionShell.Provider>
            <Probe />
          </SessionShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    let rejection: unknown;
    await act(async () => {
      await mutationState!.mutateAsync({ title: "expired" }).catch((reason: unknown) => {
        rejection = reason;
      });
      await settle();
    });
    expect(isClaimed(rejection)).toBe(true);
    expect(isCancelled(rejection)).toBe(false);
    if (!isClaimed(rejection)) throw new Error("unreachable");
    expect(rejection.data).toEqual({ tag: "session/expired", owner: "session-owner" });
    // The shell owns this outcome: failure/settled callbacks carry the same
    // residual union as state and mutate(), while control cleanup still rolls
    // back optimistic work.
    expect(failures).toEqual([]);
    expect(settled).toEqual([]);
    expect(controls).toEqual(["cleanup"]);
    expect(retryCalls).toEqual([]);
    expect(optimisticValue).toBe("original");
    // the outcome is owned above: the mutation projects idle, not failure
    expect(mutationState?.state).toBe("idle");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("plain mutation hooks discharge owned callbacks through an ambient shell", async () => {
    const SessionShell = defineShell({ name: "ambient-session-owner", claims: { SessionExpired } });
    const runtime = createQueryRuntime({ client });
    const failures: RenameFailure[] = [];
    const settled: Result<string, RenameFailure>[] = [];
    const controls: string[] = [];
    const retryCalls: number[] = [];
    let mutationState: MutationState<{ readonly title: string }, string, RenameFailure> | undefined;

    function Probe() {
      mutationState = useResultMutation(client.demo.rename, {
        retry: (_failure, count) => {
          retryCalls.push(count);
          return true;
        },
        onFailure: (failure) => void failures.push(failure),
        onSettled: (result) => void settled.push(result),
        onCancel: () => void controls.push("cleanup"),
      });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <SessionShell.Provider>
            <Probe />
          </SessionShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    let rejection: unknown;
    await act(async () => {
      await mutationState!.mutateAsync({ title: "expired" }).catch((reason: unknown) => {
        rejection = reason;
      });
      await settle();
    });
    expect(isClaimed(rejection)).toBe(true);
    expect(failures).toEqual([]);
    expect(settled).toEqual([]);
    expect(retryCalls).toEqual([]);
    expect(controls).toEqual(["cleanup"]);
    expect(mutationState?.state).toBe("idle");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("shell mutations preserve callbacks for ordinary residual failures", async () => {
    const SessionShell = defineShell({
      name: "residual-session-owner",
      claims: { SessionExpired },
    });
    const runtime = createQueryRuntime({ client });
    const failures: ResidualRenameFailure[] = [];
    const settled: Result<string, ResidualRenameFailure>[] = [];
    const controls: string[] = [];
    let mutationState:
      | MutationState<{ readonly title: string }, string, ResidualRenameFailure>
      | undefined;

    function Probe() {
      mutationState = SessionShell.useMutation(client.demo.rename, {
        retry: false,
        onFailure: (failure) => void failures.push(failure),
        onSettled: (result) => void settled.push(result),
        onCancel: () => void controls.push("cleanup"),
      });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <SessionShell.Provider>
            <Probe />
          </SessionShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    let result: Result<string, ResidualRenameFailure> | undefined;
    await act(async () => {
      result = await mutationState!.mutateAsync({ title: "conflict" });
      await settle();
    });
    expect(result?.isOk()).toBe(false);
    expect(failures.map((failure) => failure._tag)).toEqual(["doc/title-conflict"]);
    expect(settled.map((entry) => (entry.isOk() ? "ok" : entry.error._tag))).toEqual([
      "doc/title-conflict",
    ]);
    expect(controls).toEqual([]);
    expect(mutationState?.state).toBe("failure");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("mutation ownership precedes every retry form for shell and ambient hooks", async () => {
    const RetryShell = defineShell({
      name: "retry-session-owner",
      claims: { SessionExpired, SessionRefreshing },
    });
    type RetryOption =
      | false
      | number
      | ((error: RenameFailure, failureCount: number) => boolean)
      | undefined;

    const run = async (
      hook: "shell" | "plain",
      title: "expired" | "refreshing" | "conflict" | "temporary",
      retry: RetryOption,
    ) => {
      renameAttempts.set(title, 0);
      const runtime = createQueryRuntime({ client });
      const failures: RenameFailure[] = [];
      const settled: Result<string, RenameFailure>[] = [];
      let cancellations = 0;
      let mutationState:
        | MutationState<{ readonly title: string }, string, RenameFailure>
        | undefined;
      const options = {
        ...(retry === undefined ? {} : { retry }),
        onFailure: (failure: RenameFailure) => void failures.push(failure),
        onSettled: (result: Result<string, RenameFailure>) => void settled.push(result),
        onCancel: () => void (cancellations += 1),
      };

      function ShellProbe() {
        mutationState = RetryShell.useMutation(client.demo.rename, options);
        return null;
      }
      function PlainProbe() {
        mutationState = useResultMutation(client.demo.rename, options);
        return null;
      }

      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = create(
          <ResultRpcProvider runtime={runtime}>
            <RetryShell.Provider>
              {hook === "shell" ? <ShellProbe /> : <PlainProbe />}
            </RetryShell.Provider>
          </ResultRpcProvider>,
        );
        await settle();
      });
      let outcome: Result<string, RenameFailure> | undefined;
      let rejection: unknown;
      await act(async () => {
        await mutationState!.mutateAsync({ title }).then(
          (result) => {
            outcome = result;
          },
          (reason: unknown) => {
            rejection = reason;
          },
        );
        await settle();
      });
      const snapshot = {
        attempts: renameAttempts.get(title),
        cancellations,
        failures: failures.map((failure) => failure._tag),
        settled: settled.map((result) => (result.isOk() ? "ok" : result.error._tag)),
        state: mutationState?.state,
        outcome,
        rejection,
      };
      await act(async () => renderer?.unmount());
      runtime.clear();
      return snapshot;
    };

    for (const hook of ["shell", "plain"] as const) {
      let callbackCalls = 0;
      const callback = (_failure: RenameFailure, failureCount: number) => {
        callbackCalls += 1;
        return failureCount < 2;
      };
      for (const [title, retry] of [
        ["expired", false],
        ["expired", 2],
        ["expired", callback],
        ["refreshing", undefined],
      ] as const) {
        callbackCalls = 0;
        const result = await run(hook, title, retry);
        expect(result.attempts).toBe(1);
        expect(result.cancellations).toBe(1);
        expect(result.failures).toEqual([]);
        expect(result.settled).toEqual([]);
        expect(result.state).toBe("idle");
        expect(result.outcome).toBeUndefined();
        expect(isClaimed(result.rejection)).toBe(true);
        expect(callbackCalls).toBe(0);
      }
    }

    let callbackCounts: number[] = [];
    const retryResidual = (_failure: RenameFailure, failureCount: number) => {
      callbackCounts.push(failureCount);
      return failureCount < 1;
    };
    for (const [title, retry, attempts, expectedCallbackCounts] of [
      ["conflict", false, 1, []],
      ["conflict", 2, 3, []],
      ["conflict", retryResidual, 2, [0, 1]],
      ["temporary", undefined, 4, []],
    ] as const) {
      callbackCounts = [];
      const result = await run("shell", title, retry);
      expect(result.attempts).toBe(attempts);
      expect(result.cancellations).toBe(0);
      expect(result.failures).toEqual([
        title === "temporary" ? "doc/temporary-conflict" : "doc/title-conflict",
      ]);
      expect(result.settled).toEqual(result.failures);
      expect(result.state).toBe("failure");
      expect(result.outcome?.isOk()).toBe(false);
      expect(result.rejection).toBeUndefined();
      expect(callbackCounts).toEqual([...expectedCallbackCounts]);
    }
  });

  test("same-tag mutation collisions reject and render through controlled boundaries", async () => {
    const CollidingSessionExpired = error({
      tag: "session/expired",
      data: wire.object({ count: wire.number }),
    });

    for (const hook of ["shell", "plain"] as const) {
      const reactions: string[] = [];
      const CollisionShell = defineShell({
        name: `collision-${hook}`,
        claims: { CollidingSessionExpired },
        onError: (failure) => void reactions.push(`${failure._tag}:${failure.data.count}`),
      });
      const runtime = createQueryRuntime({ client });
      renameAttempts.set("expired", 0);
      const failures: RenameFailure[] = [];
      const settled: Result<string, RenameFailure>[] = [];
      let cleanups = 0;
      let rolledBack = false;
      let affected = 0;
      let caught: unknown;
      let mutationState:
        | MutationState<{ readonly title: string }, string, RenameFailure>
        | undefined;
      const options = {
        retry: false as const,
        optimistic: () => ({ rollback: () => (rolledBack = true) }),
        onFailure: (failure: RenameFailure) => void failures.push(failure),
        onSettled: (result: Result<string, RenameFailure>) => void settled.push(result),
        onCancel: (
          _input: { readonly title: string },
          context: { rollback: () => boolean } | undefined,
        ) => {
          cleanups += 1;
          context?.rollback();
        },
      };

      function Holdings() {
        affected = CollisionShell.useHeld().affected;
        return null;
      }
      function ShellProbe() {
        mutationState = CollisionShell.useMutation(client.demo.rename, options);
        return null;
      }
      function PlainProbe() {
        mutationState = useResultMutation(client.demo.rename, options);
        return null;
      }

      let renderer: ReactTestRenderer | undefined;
      const originalConsoleError = console.error;
      console.error = () => undefined;
      try {
        await act(async () => {
          renderer = create(
            <ResultRpcProvider runtime={runtime}>
              <CollisionShell.Provider>
                <Holdings />
                <TestBoundary onCaught={(error) => (caught = error)}>
                  {hook === "shell" ? <ShellProbe /> : <PlainProbe />}
                </TestBoundary>
              </CollisionShell.Provider>
            </ResultRpcProvider>,
          );
          await settle();
        });
        let rejection: unknown;
        await act(async () => {
          await mutationState!.mutateAsync({ title: "expired" }).catch((reason: unknown) => {
            rejection = reason;
          });
          await settle();
        });
        expect(renameAttempts.get("expired")).toBe(1);
        expect(rejection).toBeInstanceOf(TypeError);
        expect((rejection as Error).message).toContain("different error definition");
        expect(caught).toBeInstanceOf(TypeError);
        expect((caught as Error).message).toContain("different error definition");
        expect(failures).toEqual([]);
        expect(settled).toEqual([]);
        expect(cleanups).toBe(1);
        expect(rolledBack).toBe(true);
        expect(reactions).toEqual([]);
        expect(affected).toBe(0);
      } finally {
        console.error = originalConsoleError;
        await act(async () => renderer?.unmount());
        runtime.clear();
      }
    }
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
      return <span>{state.state === "success" ? state.value : state.error._tag}</span>;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <StrictMode>
          <ResultRpcProvider runtime={runtime}>
            <SubscriptionProbe />
            <Suspense fallback={<span>loading</span>}>
              <SuspenseProbe />
            </Suspense>
          </ResultRpcProvider>
        </StrictMode>,
      );
      await settle();
    });
    expect(subscriptionState?.connection).toBe("closed");
    expect(subscriptionState?.result).toEqual(ok("event:one"));
    expect(JSON.stringify(renderer?.toJSON())).toContain("suspense");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("inline hook options never loop, and the current render's callbacks win", async () => {
    const runtime = createQueryRuntime({ client });
    const successCalls: string[] = [];
    let mutationState: MutationState<{ readonly title: string }, string, RenameFailure> | undefined;
    let rerender: () => void = () => undefined;

    function Probe({ generation }: { generation: number }) {
      // Inline options object with an inline callback — new identity every
      // render, exactly how React codebases write it. Must not resubscribe,
      // must not "Maximum update depth exceeded", and the latest render's
      // callback is the one that fires.
      mutationState = useResultMutation(client.demo.rename, {
        onSuccess: () => void successCalls.push(`gen-${generation}`),
      });
      // Inline query options too (retry as an inline function).
      useResultQuery(client.demo.value, { id: "one" }, { retry: () => false });
      return null;
    }
    function Host() {
      const [generation, setGeneration] = useState(0);
      rerender = () => setGeneration((n) => n + 1);
      return <Probe generation={generation} />;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <Host />
        </ResultRpcProvider>,
      );
      await settle();
    });
    await act(async () => {
      rerender();
      rerender();
      await settle();
    });
    await act(async () => {
      await mutationState!.mutateAsync({ title: "renamed" });
      await settle();
    });
    expect(successCalls).toEqual(["gen-2"]);
    expect(mutationState?.state).toBe("success");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("inline subscription retry callbacks do not replace or loop the observer", async () => {
    let streamStarts = 0;
    const app = rpc.context<{}>();
    const eventDeclaration = app
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .subscription();
    const eventStream = app.implement(eventDeclaration).stream(async function* () {
      streamStarts += 1;
      yield ok("first");
      await Promise.resolve();
      yield ok("second");
    });
    const eventRouter = app.router({ events: eventStream });
    const eventHandler = createFetchHandler({
      router: eventRouter,
      createContext: () => ({}),
    });
    const eventClient = createFixtureClient({
      router: eventRouter,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          eventHandler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: eventClient });
    let subscriptionState: SubscriptionState<string, FrameworkFailure> | undefined;
    let rerender: () => void = () => undefined;

    function Probe({ generation }: { generation: number }) {
      subscriptionState = useResultSubscription(
        eventClient.events,
        {},
        {
          retry: () => generation < 0,
          retryDelayMs: () => generation,
        },
      );
      return null;
    }
    function Host() {
      const [generation, setGeneration] = useState(0);
      rerender = () => setGeneration((current) => current + 1);
      return <Probe generation={generation} />;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <Host />
        </ResultRpcProvider>,
      );
      await settle();
      rerender();
      rerender();
      await settle();
    });
    expect(streamStarts).toBe(1);
    expect(subscriptionState?.eventCount).toBe(2);
    expect(subscriptionState?.result).toEqual(ok("second"));
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("inline paginated retry callbacks do not replace the observer", async () => {
    let pageRequests = 0;
    const app = rpc.context<{}>();
    const feed = app
      .procedure()
      .input(wire.object({ q: wire.string }))
      .output(wire.string)
      .paginate({ cursor: wire.string }, ({ input }) => {
        pageRequests += 1;
        return ok({ items: [input.list.q], nextCursor: null });
      });
    const pageRouter = app.router({ feed });
    const pageHandler = createFetchHandler({ router: pageRouter, createContext: () => ({}) });
    const pageClient = createFixtureClient({
      router: pageRouter,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          pageHandler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: pageClient });
    let state: PaginatedState<string, FrameworkFailure> | undefined;
    let rerender: () => void = () => undefined;

    function Probe({ generation }: { generation: number }) {
      state = useResultPaginatedQuery(
        pageClient.feed,
        { q: "one" },
        {
          retry: () => generation < 0,
        },
      );
      return null;
    }
    function Host() {
      const [generation, setGeneration] = useState(0);
      rerender = () => setGeneration((current) => current + 1);
      return <Probe generation={generation} />;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <Host />
        </ResultRpcProvider>,
      );
      await settle();
    });
    await act(async () => {
      rerender();
      rerender();
      await settle();
    });
    expect(state?.state).toBe("success");
    expect(state?.rows).toEqual(["one"]);
    expect(pageRequests).toBe(1);
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("an active subscription reads the latest render's retry callback", async () => {
    let releaseFailure: () => void = () => undefined;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    let streamStarts = 0;
    const Retryable = error({ tag: "subscription/retryable", retry: "transient" });
    const app = rpc.context<{}>();
    const eventDeclaration = app
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .errors({ Retryable })
      .subscription();
    const eventStream = app.implement(eventDeclaration).stream(async function* () {
      streamStarts += 1;
      await failureGate;
      yield err(Retryable());
    });
    const eventRouter = app.router({ events: eventStream });
    const eventHandler = createFetchHandler({
      router: eventRouter,
      createContext: () => ({}),
    });
    const eventClient = createFixtureClient({
      router: eventRouter,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          eventHandler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: eventClient });
    const retryCalls: number[] = [];
    let rerender: () => void = () => undefined;

    function Probe({ generation }: { generation: number }) {
      useResultSubscription(
        eventClient.events,
        {},
        {
          retry: () => {
            retryCalls.push(generation);
            return false;
          },
        },
      );
      return null;
    }
    function Host() {
      const [generation, setGeneration] = useState(0);
      rerender = () => setGeneration(1);
      return <Probe generation={generation} />;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <Host />
        </ResultRpcProvider>,
      );
      await settle();
    });
    await act(async () => {
      rerender();
      await settle();
    });
    await act(async () => {
      releaseFailure();
      await settle();
    });
    expect(streamStarts).toBe(1);
    expect(retryCalls).toEqual([1]);
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a programmer error travels by throw: mutate rejects, state resets to idle", async () => {
    const runtime = createQueryRuntime({ client });
    const failures: unknown[] = [];
    let mutationState: MutationState<{ readonly title: string }, string, RenameFailure> | undefined;

    function Probe() {
      mutationState = useResultMutation(client.demo.rename, {
        onFailure: (failure) => void failures.push(failure),
      });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <Probe />
        </ResultRpcProvider>,
      );
      await settle();
    });
    let rejection: unknown;
    await act(async () => {
      // Input the client's own codec rejects — never reaches the wire.
      await mutationState!.mutateAsync({ wrong: true } as never).catch((reason: unknown) => {
        rejection = reason;
      });
      await settle();
    });
    expect(rejection).toBeInstanceOf(TypeError);
    // Not laundered into the tagged channel: no failure state, no onFailure.
    expect(mutationState?.state).toBe("idle");
    expect(failures).toEqual([]);
    await act(async () => renderer?.unmount());
    runtime.clear();
  });
});

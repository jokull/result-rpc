import { describe, expect, test } from "bun:test";
import { Component, StrictMode, Suspense, useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { defectErrors, err, error, ok, transportErrors, wire } from "../index.js";
import type { ClientEvent } from "../client/client.js";
import { fetchTransport, type ClientTransport } from "../client/transport.js";
import { createQueryRuntime } from "../query/runtime.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { createFixtureClient } from "../testing/index.js";
import {
  ResultRpcProvider,
  ResultSuspense,
  defineShell,
  useResultQuery,
  useResultSuspenseQuery,
} from "./index.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SessionExpired = error({
  tag: "auth/session-expired",
  data: wire.object({}),
  httpStatus: 401,
  retry: "never",
  visibility: "public",
});

const TripNotFound = error({
  tag: "trip/not-found",
  data: wire.object({ docId: wire.string }),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
});

const authErrors = { SessionExpired } as const;

const r = rpc.context<{}>();
const trip = r
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ SessionExpired, TripNotFound })
  .query(({ input, errors }) => {
    if (input.id === "expired") return err(errors.SessionExpired({}));
    if (input.id === "missing") return err(errors.TripNotFound({ docId: input.id }));
    if (input.id === "boom") throw new Error("handler defect");
    return ok(input.id);
  });
const feed = r
  .procedure()
  .input(wire.object({ q: wire.string }))
  .output(wire.string)
  .errors({ SessionExpired, TripNotFound })
  .paginate({ cursor: wire.string }, ({ input, errors }) =>
    input.list.q === "expired"
      ? err(errors.SessionExpired({}))
      : ok({ items: [input.list.q], nextCursor: null }),
  );
const router = r.router({ trip, feed });
const handler = createFetchHandler({ router, createContext: () => ({}) });

const localFetch = ((input: string | URL | Request, init?: RequestInit) =>
  handler(new Request(input, init))) as typeof globalThis.fetch;
const httpTransport: ClientTransport = fetchTransport({
  url: "https://example.test/rpc",
  fetch: localFetch,
});

const offlineTransport: ClientTransport = {
  request: async () => ({ ok: false, reason: "offline" }),
};

const clientFor = (transport: ClientTransport) => createFixtureClient({ router, transport });

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// app shell: transport failures pause and feed one aggregate banner
const AppShell = defineShell({
  name: "app",
  claims: transportErrors,
  effect: "pause",
});

// defect shell: nothing renders a branch for these
const DefectShell = defineShell({
  name: "defect",
  from: AppShell,
  claims: defectErrors,
  effect: "escalate",
});

class Boundary extends Component<
  { children?: ReactNode; onCaught?: (value: unknown) => void },
  { caught?: unknown }
> {
  override state: { caught?: unknown } = {};
  static getDerivedStateFromError(caught: unknown) {
    return { caught };
  }
  override componentDidCatch(caught: unknown) {
    this.props.onCaught?.(caught);
  }
  override render() {
    const caught = this.state.caught;
    if (caught === undefined) return this.props.children;
    return <span>{(caught as { _tag: string })._tag}</span>;
  }
}

describe("shells", () => {
  test("the public registry is the exact definition chain, not a tag predicate", () => {
    const AuthShell = defineShell({
      name: "auth",
      from: DefectShell,
      claims: authErrors,
    });
    const SameSignatureButDifferentDefinition = error({
      tag: "auth/session-expired",
      data: wire.object({}),
    });

    expect(AuthShell.$errors.definitions.get(SessionExpired.tag)).toBe(SessionExpired);
    expect(AuthShell.$errors.definitions.get("client/offline")).toBe(transportErrors.ClientOffline);
    expect(AuthShell.$errors.is(SessionExpired({}))).toBe(true);
    expect(AuthShell.$errors.is(transportErrors.ClientOffline())).toBe(true);
    expect(AuthShell.$errors.is(TripNotFound({ docId: "trip_1" }))).toBe(false);
    expect(AuthShell.$errors.is(SameSignatureButDifferentDefinition({}))).toBe(false);
  });

  test("same-tag definitions cannot reach a shell's typed callback", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const RogueSessionExpired = error({
      tag: "auth/session-expired",
      data: wire.object({ count: wire.number }),
    });
    let callbackRan = false;
    let caught: unknown;
    const RogueShell = defineShell({
      name: "rogue-auth",
      claims: { RogueSessionExpired },
      onError: (failure) => {
        callbackRan = true;
        failure.data.count.toFixed();
      },
    });

    function Probe() {
      RogueShell.useQuery(client.trip, { id: "expired" }, { retry: false });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <Boundary onCaught={(value) => (caught = value)}>
            <RogueShell.Provider>
              <Probe />
            </RogueShell.Provider>
          </Boundary>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toContain("different error definition");
    expect(callbackRan).toBe(false);
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a shell paginated hook claims failures and narrows its error union", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const AuthShell = defineShell({ name: "auth", claims: authErrors });

    let state: string | undefined;
    let affected = 0;
    function Probe() {
      const page = AuthShell.usePaginatedQuery(client.feed, { q: "expired" });
      state = page.state;
      affected = AuthShell.useHeld().affected;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AuthShell.Provider>
            <Probe />
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(state).toBe("pending");
    expect(affected).toBe(1);
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("unclaimed domain errors stay in the component union", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const AuthShell = defineShell({
      name: "auth",
      from: DefectShell,
      claims: authErrors,
      provide: (props: { readonly userId: string }) => props.userId,
    });

    let tag: string | undefined;
    function Probe() {
      const query = AuthShell.useQuery(client.trip, { id: "missing" });
      if (query.state === "failure") tag = query.error._tag;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <AuthShell.Provider userId="u_1">
                <Probe />
              </AuthShell.Provider>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(tag).toBe("trip/not-found");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a claimed error pauses the query, fires onError, and exposes the guaranteed value", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const seen: string[] = [];
    const AuthShell = defineShell({
      name: "auth",
      from: DefectShell,
      claims: authErrors,
      onError: (failure, userId) => seen.push(`${failure._tag}:${userId}`),
      provide: (props: { readonly userId: string }) => props.userId,
    });

    let state: string | undefined;
    let fetchState: string | undefined;
    let affected = 0;
    let userId: string | undefined;
    function Probe() {
      const query = AuthShell.useQuery(client.trip, { id: "expired" });
      userId = AuthShell.use();
      affected = AuthShell.useHeld().affected;
      state = query.state;
      fetchState = query.fetch;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <AuthShell.Provider userId="u_1">
                <Probe />
              </AuthShell.Provider>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(state).toBe("pending");
    expect(fetchState).toBe("paused");
    expect(seen).toEqual(["auth/session-expired:u_1"]);
    expect(affected).toBe(1);
    expect(userId).toBe("u_1");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("transport failures pause under the app shell and aggregate", async () => {
    const client = clientFor(offlineTransport);
    const runtime = createQueryRuntime({ client });

    let state: string | undefined;
    let affected = 0;
    let activeTag: string | undefined;
    function Probe() {
      const query = AppShell.useQuery(client.trip, { id: "one" }, { retry: false });
      const active = AppShell.useHeld();
      affected = active.affected;
      activeTag = active.latest?._tag;
      state = query.state;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <Probe />
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(state).toBe("pending");
    expect(affected).toBe(1);
    expect(activeTag).toBe("client/offline");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("defects escalate to the nearest error boundary", async () => {
    const events: ClientEvent[] = [];
    const client = createFixtureClient({
      router,
      transport: httpTransport,
      onEvent: (event) => events.push(event),
    });
    const runtime = createQueryRuntime({ client });
    let affected = 0;

    function Holdings() {
      affected = DefectShell.useHeld().affected;
      return null;
    }

    function Probe() {
      DefectShell.useQuery(client.trip, { id: "boom" }, { retry: false });
      return <span>ok</span>;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <Holdings />
              <Boundary>
                <Probe />
              </Boundary>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("server/internal");
    expect(affected).toBe(0);
    expect(events.map((event) => event.type)).toEqual(["call", "failure"]);
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a tag can only be claimed once per chain", () => {
    expect(() =>
      // @ts-expect-error A parent already owns every transport definition.
      defineShell({
        name: "duplicate",
        from: AppShell,
        claims: transportErrors,
      }),
    ).toThrow(/already claimed by app/);
  });

  test("a shell must be mounted inside its parent", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    let caught: unknown;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <Boundary
            onCaught={(value) => {
              caught = value;
            }}
          >
            <DefectShell.Provider>
              <span>mounted</span>
            </DefectShell.Provider>
          </Boundary>
        </ResultRpcProvider>,
      );
    });
    expect((caught as Error).message).toBe("Shell defect must be mounted inside app");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });
});

describe("ambient claiming", () => {
  test("plain hooks under a shell are monitored: claimed failures pause and aggregate", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const seen: string[] = [];
    const AuthShell = defineShell({
      name: "ambient-auth",
      from: DefectShell,
      claims: authErrors,
      onError: (failure) => seen.push(failure._tag),
      provide: (props: { readonly userId: string }) => props.userId,
    });

    let state: string | undefined;
    let fetchState: string | undefined;
    let affected = 0;
    function Probe() {
      // NOT AuthShell.useQuery — the plain hook, no shell knowledge at all
      const query = useResultQuery(client.trip, { id: "expired" });
      state = query.state;
      fetchState = query.fetch;
      affected = AuthShell.useHeld().affected;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <AuthShell.Provider userId="u_9">
                <Probe />
              </AuthShell.Provider>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    // the session-expired failure never became state:"failure" anywhere
    expect(state).toBe("pending");
    expect(fetchState).toBe("paused");
    expect(seen).toEqual(["auth/session-expired"]);
    expect(affected).toBe(1);
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("one observer cannot release a shared query claim leased by its sibling", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const reactions: string[] = [];
    const AuthShell = defineShell({
      name: "leased-auth",
      claims: authErrors,
      onError: (failure) => void reactions.push(failure._tag),
    });
    let hideFirst: () => void = () => undefined;
    let affected = 0;
    let resume: () => void = () => undefined;
    const states = new Map<string, string>();

    function Probe({ name }: { name: string }) {
      const query = useResultQuery(client.trip, { id: "expired" }, { retry: false });
      states.set(name, query.state);
      return null;
    }
    function Host() {
      const [showFirst, setShowFirst] = useState(true);
      hideFirst = () => setShowFirst(false);
      const held = AuthShell.useHeld();
      affected = held.affected;
      resume = held.resume;
      return (
        <>
          {showFirst ? <Probe key="first" name="first" /> : null}
          <Probe key="second" name="second" />
        </>
      );
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AuthShell.Provider>
            <Host />
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(states.get("first")).toBe("pending");
    expect(states.get("second")).toBe("pending");
    expect(affected).toBe(1);
    expect(reactions).toEqual(["auth/session-expired"]);

    await act(async () => {
      hideFirst();
      await settle();
    });
    expect(affected).toBe(1);
    expect(states.get("second")).toBe("pending");
    expect(reactions).toEqual(["auth/session-expired"]);

    await act(async () => {
      resume();
      await settle();
    });
    expect(affected).toBe(1);
    expect(states.get("second")).toBe("pending");
    expect(reactions).toEqual(["auth/session-expired", "auth/session-expired"]);

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("committed ResultSuspense boundaries retire same-key leases independently", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const reactions: string[] = [];
    const AuthShell = defineShell({
      name: "suspense-lease-auth",
      claims: authErrors,
      onError: (failure) => void reactions.push(failure._tag),
    });
    let hideFirst: () => void = () => undefined;
    let hideSecond: () => void = () => undefined;
    let affected = 0;

    function Holdings() {
      affected = AuthShell.useHeld().affected;
      return null;
    }
    function Probe() {
      useResultSuspenseQuery(client.trip, { id: "expired" }, { retry: false });
      return null;
    }
    function Host() {
      const [first, setFirst] = useState(true);
      const [second, setSecond] = useState(true);
      hideFirst = () => setFirst(false);
      hideSecond = () => setSecond(false);
      return (
        <>
          <Holdings />
          {first ? (
            <ResultSuspense fallback={<span>loading-first</span>}>
              <Probe />
            </ResultSuspense>
          ) : null}
          {second ? (
            <ResultSuspense fallback={<span>loading-second</span>}>
              <Probe />
            </ResultSuspense>
          ) : null}
        </>
      );
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AuthShell.Provider>
            <Host />
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(affected).toBe(1);
    expect(reactions).toEqual(["auth/session-expired"]);

    await act(async () => {
      hideFirst();
      await settle();
    });
    expect(affected).toBe(1);

    await act(async () => {
      hideSecond();
      await settle();
    });
    expect(affected).toBe(0);
    expect(reactions).toEqual(["auth/session-expired"]);

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("committed ResultSuspense boundaries retire distinct operations independently", async () => {
    const localRpc = rpc.context<{}>();
    const guarded = localRpc
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ SessionExpired })
      .query(({ errors }) => err(errors.SessionExpired({})));
    const localRouter = localRpc.router({ guarded });
    const localHandler = createFetchHandler({ router: localRouter, createContext: () => ({}) });
    const client = createFixtureClient({
      router: localRouter,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          localHandler(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client });
    const AuthShell = defineShell({ name: "distinct-suspense-auth", claims: authErrors });
    let remove: (id: string) => void = () => undefined;
    let affected = 0;

    function Holdings() {
      affected = AuthShell.useHeld().affected;
      return null;
    }
    function Probe({ id }: { id: string }) {
      useResultSuspenseQuery(client.guarded, { id }, { retry: false });
      return null;
    }
    function Host() {
      const [ids, setIds] = useState(["a", "b", "c", "d"]);
      remove = (id) => setIds((current) => current.filter((candidate) => candidate !== id));
      return (
        <>
          <Holdings />
          {ids.map((id) => (
            <ResultSuspense key={id} fallback={<span>loading-{id}</span>}>
              <Probe id={id} />
            </ResultSuspense>
          ))}
        </>
      );
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AuthShell.Provider>
            <Host />
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(affected).toBe(4);

    await act(async () => {
      remove("b");
      remove("d");
      await settle();
    });
    expect(affected).toBe(2);

    await act(async () => {
      remove("a");
      remove("c");
      await settle();
    });
    expect(affected).toBe(0);

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("resetKey retires claims when a retained ResultSuspense changes subtree", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const AuthShell = defineShell({ name: "reset-suspense-auth", claims: authErrors });
    let replace: () => void = () => undefined;
    let affected = 0;

    function Holdings() {
      affected = AuthShell.useHeld().affected;
      return null;
    }
    function Probe() {
      useResultSuspenseQuery(client.trip, { id: "expired" }, { retry: false });
      return null;
    }
    function Host() {
      const [branch, setBranch] = useState<"query" | "empty">("query");
      replace = () => setBranch("empty");
      return (
        <>
          <Holdings />
          <ResultSuspense resetKey={branch} fallback={<span>loading</span>}>
            {branch === "query" ? <Probe /> : <span>replacement</span>}
          </ResultSuspense>
        </>
      );
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AuthShell.Provider>
            <Host />
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(affected).toBe(1);

    await act(async () => {
      replace();
      await settle();
    });
    expect(affected).toBe(0);
    expect(JSON.stringify(renderer?.toJSON())).toContain("replacement");

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("plain React Suspense rejects a shell claim without creating ownerless state", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const AuthShell = defineShell({ name: "unowned-suspense-auth", claims: authErrors });
    let affected = 0;
    let caught: unknown;

    function Holdings() {
      affected = AuthShell.useHeld().affected;
      return null;
    }
    function Probe() {
      useResultSuspenseQuery(client.trip, { id: "expired" }, { retry: false });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AuthShell.Provider>
            <Holdings />
            <Boundary onCaught={(value) => (caught = value)}>
              <Suspense fallback={<span>loading</span>}>
                <Probe />
              </Suspense>
            </Boundary>
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toContain("<ResultSuspense>");
    expect(affected).toBe(0);

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("outside any shell, plain hooks surface the full union unchanged", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    let tag: string | undefined;
    function Probe() {
      const query = useResultQuery(client.trip, { id: "expired" });
      if (query.state === "failure") tag = query.error._tag;
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
    expect(tag).toBe("auth/session-expired");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a shell hook outside its mounted chain fails eagerly, not on first error", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    function Probe() {
      DefectShell.useQuery(client.trip, { id: "ok" }); // would succeed — but the chain is absent
      return <span>rendered</span>;
    }
    let caught: unknown;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <Boundary
            onCaught={(value) => {
              caught = value;
            }}
          >
            <Probe />
          </Boundary>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(String((caught as Error).message)).toContain("is not mounted");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });
});

describe("claim breadcrumbs", () => {
  test("a claim emits into the client event stream with owner and effect", async () => {
    const events: ClientEvent[] = [];
    const client = createFixtureClient({
      router,
      transport: httpTransport,
      onEvent: (event) => events.push(event),
    });
    const runtime = createQueryRuntime({ client });
    const AuthShell = defineShell({
      name: "crumb-auth",
      from: DefectShell,
      claims: authErrors,
      provide: (props: { readonly userId: string }) => props.userId,
    });

    function Probe() {
      useResultQuery(client.trip, { id: "expired" });
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <AuthShell.Provider userId="u_1">
                <Probe />
              </AuthShell.Provider>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    const claimed = events.filter(
      (event): event is Extract<ClientEvent, { type: "claimed" }> => event.type === "claimed",
    );
    expect(claimed).toEqual([
      {
        type: "claimed",
        path: "trip",
        tag: "auth/session-expired",
        owner: "crumb-auth",
        effect: "pause",
      },
    ]);
    // the wire failure precedes the claim in the trail
    expect(events.map((event) => event.type)).toEqual(["call", "failure", "claimed"]);
    await act(async () => renderer?.unmount());
    runtime.clear();
  });
});

describe("resume lifecycle", () => {
  test("a first-render claimed Suspense failure reaches its shell and resumes", async () => {
    let sessionValid = false;
    const r2 = rpc.context<{}>();
    const guarded = r2
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ SessionExpired })
      .query(({ input, errors }) =>
        sessionValid ? ok(`data:${input.id}`) : err(errors.SessionExpired({})),
      );
    const router2 = r2.router({ guarded });
    const handler2 = createFetchHandler({ router: router2, createContext: () => ({}) });
    const client2 = createFixtureClient({
      router: router2,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler2(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: client2 });
    const seen: string[] = [];
    const AuthShell = defineShell({
      name: "suspense-auth",
      claims: authErrors,
      onError: (failure) => seen.push(failure._tag),
    });

    let affected = 0;
    let errorCount = 0;
    let latestTag: string | undefined;
    let resume: (() => void) | undefined;
    function Holdings() {
      const held = AuthShell.useHeld();
      affected = held.affected;
      errorCount = held.errors.length;
      latestTag = held.latest?._tag;
      resume = held.resume;
      return <span>affected:{held.affected}</span>;
    }
    function Probe() {
      const state = useResultSuspenseQuery(client2.guarded, { id: "a" }, { retry: false });
      return <span>{state.state === "success" ? state.value : state.error._tag}</span>;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <StrictMode>
          <ResultRpcProvider runtime={runtime}>
            <AuthShell.Provider>
              <Holdings />
              <ResultSuspense fallback={<span>loading</span>}>
                <Probe />
              </ResultSuspense>
            </AuthShell.Provider>
          </ResultRpcProvider>
        </StrictMode>,
      );
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("loading");
    expect(affected).toBe(1);
    expect(errorCount).toBe(1);
    expect(latestTag).toBe("auth/session-expired");
    expect(seen).toEqual(["auth/session-expired"]);

    sessionValid = true;
    await act(async () => {
      resume!();
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("data:a");
    expect(affected).toBe(0);
    expect(seen).toEqual(["auth/session-expired"]);

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("an abandoned first-render Suspense request cannot acquire a shell claim", async () => {
    let releaseRequest: () => void = () => undefined;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const r2 = rpc.context<{}>();
    const guarded = r2
      .procedure()
      .input(wire.object({}))
      .output(wire.string)
      .errors({ SessionExpired })
      .query(async ({ errors }) => {
        await requestGate;
        return err(errors.SessionExpired({}));
      });
    const router2 = r2.router({ guarded });
    const handler2 = createFetchHandler({ router: router2, createContext: () => ({}) });
    const client2 = createFixtureClient({
      router: router2,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler2(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: client2 });
    const reactions: string[] = [];
    const AuthShell = defineShell({
      name: "abandoned-suspense-auth",
      claims: authErrors,
      onError: (failure) => void reactions.push(failure._tag),
    });
    let hide: () => void = () => undefined;
    let affected = 0;

    function Holdings() {
      affected = AuthShell.useHeld().affected;
      return null;
    }
    function Probe() {
      useResultSuspenseQuery(client2.guarded, {}, { retry: false });
      return null;
    }
    function Host() {
      const [shown, setShown] = useState(true);
      hide = () => setShown(false);
      return (
        <>
          <Holdings />
          {shown ? (
            <ResultSuspense fallback={<span>loading</span>}>
              <Probe />
            </ResultSuspense>
          ) : null}
        </>
      );
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AuthShell.Provider>
            <Host />
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("loading");
    expect(affected).toBe(0);

    await act(async () => {
      hide();
      await settle();
    });
    await act(async () => {
      releaseRequest();
      await settle();
    });
    expect(affected).toBe(0);
    expect(reactions).toEqual([]);

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("an unmounted update suspension cannot acquire a shell claim after settlement", async () => {
    let releaseRequest: () => void = () => undefined;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const r2 = rpc.context<{}>();
    const guarded = r2
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ SessionExpired })
      .query(async ({ input, errors }) => {
        if (input.id === "ready") return ok("ready");
        await requestGate;
        return err(errors.SessionExpired({}));
      });
    const router2 = r2.router({ guarded });
    const handler2 = createFetchHandler({ router: router2, createContext: () => ({}) });
    const client2 = createFixtureClient({
      router: router2,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler2(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: client2 });
    const reactions: string[] = [];
    const AuthShell = defineShell({
      name: "unmounted-update-auth",
      claims: authErrors,
      onError: (failure) => void reactions.push(failure._tag),
    });
    let suspendUpdate: () => void = () => undefined;
    let hide: () => void = () => undefined;
    let affected = 0;

    function Holdings() {
      affected = AuthShell.useHeld().affected;
      return null;
    }
    function Probe({ id }: { readonly id: string }) {
      const state = useResultSuspenseQuery(client2.guarded, { id }, { retry: false });
      return <span>{state.state === "success" ? state.value : state.error._tag}</span>;
    }
    function Host() {
      const [shown, setShown] = useState(true);
      const [id, setId] = useState("ready");
      suspendUpdate = () => setId("deferred");
      hide = () => setShown(false);
      return (
        <>
          <Holdings />
          {shown ? (
            <ResultSuspense fallback={<span>loading</span>}>
              <Probe id={id} />
            </ResultSuspense>
          ) : null}
        </>
      );
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AuthShell.Provider>
            <Host />
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("ready");

    await act(async () => {
      suspendUpdate();
      await settle();
    });
    await act(async () => {
      hide();
      await settle();
    });
    await act(async () => {
      releaseRequest();
      await settle();
    });
    expect(affected).toBe(0);
    expect(reactions).toEqual([]);

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a superseded committed suspension cannot acquire after the newer UI commits", async () => {
    let releaseLate: () => void = () => undefined;
    const lateGate = new Promise<void>((resolve) => {
      releaseLate = resolve;
    });
    const r2 = rpc.context<{}>();
    const guarded = r2
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ SessionExpired })
      .query(async ({ input, errors }) => {
        if (input.id !== "late") return ok(`data:${input.id}`);
        await lateGate;
        return err(errors.SessionExpired({}));
      });
    const router2 = r2.router({ guarded });
    const handler2 = createFetchHandler({ router: router2, createContext: () => ({}) });
    const client2 = createFixtureClient({
      router: router2,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler2(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: client2 });
    const reactions: string[] = [];
    const AuthShell = defineShell({
      name: "superseded-update-auth",
      claims: authErrors,
      onError: (failure) => void reactions.push(failure._tag),
    });
    let showLate: () => void = () => undefined;
    let showNewer: () => void = () => undefined;
    let affected = 0;

    function Holdings() {
      affected = AuthShell.useHeld().affected;
      return <span>held:{affected}</span>;
    }
    function Probe({ id }: { readonly id: string }) {
      const state = useResultSuspenseQuery(client2.guarded, { id }, { retry: false });
      return <span>{state.state === "success" ? state.value : state.error._tag}</span>;
    }
    function Host() {
      const [id, setId] = useState("ready");
      showLate = () => setId("late");
      showNewer = () => setId("newer");
      return (
        <>
          <Holdings />
          <ResultSuspense fallback={<span>loading</span>}>
            <Probe id={id} />
          </ResultSuspense>
        </>
      );
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AuthShell.Provider>
            <Host />
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("data:ready");

    await act(async () => {
      showLate();
      await settle();
    });
    await act(async () => {
      showNewer();
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("data:newer");

    await act(async () => {
      releaseLate();
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("data:newer");
    expect(affected).toBe(0);
    expect(reactions).toEqual([]);

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("Strict Mode collapses replay but preserves distinct suspended query operations", async () => {
    let sessionValid = false;
    const r2 = rpc.context<{}>();
    const guarded = r2
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ SessionExpired })
      .query(({ input, errors }) =>
        sessionValid ? ok(`data:${input.id}`) : err(errors.SessionExpired({})),
      );
    const router2 = r2.router({ guarded });
    const handler2 = createFetchHandler({ router: router2, createContext: () => ({}) });
    const client2 = createFixtureClient({
      router: router2,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler2(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: client2 });
    const seen: string[] = [];
    const AuthShell = defineShell({
      name: "suspense-siblings",
      claims: authErrors,
      onError: (failure) => seen.push(failure._tag),
    });

    let affected = 0;
    let errorCount = 0;
    let latestTag: string | undefined;
    let resume: (() => void) | undefined;
    function Holdings() {
      const held = AuthShell.useHeld();
      affected = held.affected;
      errorCount = held.errors.length;
      latestTag = held.latest?._tag;
      resume = held.resume;
      return null;
    }
    function Probe({ id }: { readonly id: string }) {
      const state = useResultSuspenseQuery(client2.guarded, { id }, { retry: false });
      return <span>{state.state === "success" ? state.value : state.error._tag}</span>;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <StrictMode>
          <ResultRpcProvider runtime={runtime}>
            <AuthShell.Provider>
              <Holdings />
              <ResultSuspense fallback={<span>loading-a</span>}>
                <Probe id="a" />
              </ResultSuspense>
              <ResultSuspense fallback={<span>loading-b</span>}>
                <Probe id="b" />
              </ResultSuspense>
            </AuthShell.Provider>
          </ResultRpcProvider>
        </StrictMode>,
      );
      await settle();
    });
    expect(affected).toBe(2);
    expect(errorCount).toBe(2);
    expect(latestTag).toBe("auth/session-expired");
    expect(seen).toHaveLength(2);

    sessionValid = true;
    await act(async () => {
      resume!();
      await settle();
    });
    const rendered = JSON.stringify(renderer?.toJSON());
    expect(rendered).toContain("data:a");
    expect(rendered).toContain("data:b");
    expect(affected).toBe(0);

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a claimed background refetch keeps stale Suspense data and remains resumable", async () => {
    let sessionValid = true;
    const r2 = rpc.context<{}>();
    const guarded = r2
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ SessionExpired })
      .query(({ input, errors }) =>
        sessionValid ? ok(`data:${input.id}`) : err(errors.SessionExpired({})),
      );
    const router2 = r2.router({ guarded });
    const handler2 = createFetchHandler({ router: router2, createContext: () => ({}) });
    const client2 = createFixtureClient({
      router: router2,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler2(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: client2 });
    const seen: string[] = [];
    const AuthShell = defineShell({
      name: "suspense-background",
      claims: authErrors,
      onError: (failure) => seen.push(failure._tag),
    });

    let refetch: (() => Promise<void>) | undefined;
    let affected = 0;
    let resume: (() => void) | undefined;
    function Holdings() {
      const held = AuthShell.useHeld();
      affected = held.affected;
      resume = held.resume;
      return null;
    }
    function Probe() {
      const state = useResultSuspenseQuery(client2.guarded, { id: "a" }, { retry: false });
      refetch = state.refetch;
      return <span>{state.state === "success" ? state.value : state.error._tag}</span>;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AuthShell.Provider>
            <Holdings />
            <ResultSuspense fallback={<span>loading</span>}>
              <Probe />
            </ResultSuspense>
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("data:a");

    sessionValid = false;
    await act(async () => {
      await refetch!();
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("data:a");
    expect(affected).toBe(1);
    expect(seen).toEqual(["auth/session-expired"]);

    sessionValid = true;
    await act(async () => {
      resume!();
      await settle();
    });
    expect(affected).toBe(0);
    expect(JSON.stringify(renderer?.toJSON())).toContain("data:a");

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a hydrated success can become a claimed background failure without suspending forever", async () => {
    let sessionValid = true;
    const r2 = rpc.context<{}>();
    const guarded = r2
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ SessionExpired })
      .query(({ input, errors }) =>
        sessionValid ? ok(`hydrated:${input.id}`) : err(errors.SessionExpired({})),
      );
    const router2 = r2.router({ guarded });
    const handler2 = createFetchHandler({ router: router2, createContext: () => ({}) });
    const client2 = createFixtureClient({
      router: router2,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler2(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const serverRuntime = createQueryRuntime({ client: client2 });
    await serverRuntime.prefetch(client2.guarded, { id: "a" });
    const dehydrated = serverRuntime.dehydrate();
    const browserRuntime = createQueryRuntime({ client: client2 });
    sessionValid = false;

    const AuthShell = defineShell({ name: "suspense-hydrated", claims: authErrors });
    let affected = 0;
    let resume: (() => void) | undefined;
    function Holdings() {
      const held = AuthShell.useHeld();
      affected = held.affected;
      resume = held.resume;
      return null;
    }
    function Probe() {
      const state = useResultSuspenseQuery(client2.guarded, { id: "a" }, { retry: false });
      return <span>{state.state === "success" ? state.value : state.error._tag}</span>;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={browserRuntime} hydrate={dehydrated}>
          <AuthShell.Provider>
            <Holdings />
            <ResultSuspense fallback={<span>loading</span>}>
              <Probe />
            </ResultSuspense>
          </AuthShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("hydrated:a");
    expect(affected).toBe(1);

    sessionValid = true;
    await act(async () => {
      resume!();
      await settle();
    });
    expect(affected).toBe(0);
    expect(JSON.stringify(renderer?.toJSON())).toContain("hydrated:a");

    await act(async () => renderer?.unmount());
    browserRuntime.clear();
    serverRuntime.clear();
  });

  test("an escalated first-render Suspense failure reaches the error boundary", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });

    function Probe() {
      useResultSuspenseQuery(client.trip, { id: "boom" }, { retry: false });
      return <span>unreachable</span>;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <Boundary>
                <ResultSuspense fallback={<span>loading</span>}>
                  <Probe />
                </ResultSuspense>
              </Boundary>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("server/internal");

    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("resume() retries held queries after the condition is fixed", async () => {
    // a server whose session validity is mutable mid-flight
    let sessionValid = false;
    const r2 = rpc.context<{}>();
    const guarded = r2
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ SessionExpired })
      .query(({ input, errors }) =>
        sessionValid ? ok(`data:${input.id}`) : err(errors.SessionExpired({})),
      );
    const router2 = r2.router({ guarded });
    const handler2 = createFetchHandler({ router: router2, createContext: () => ({}) });
    const client2 = createFixtureClient({
      router: router2,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler2(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: client2 });
    const AuthShell = defineShell({
      name: "resume-auth",
      from: DefectShell,
      claims: authErrors,
      provide: (props: { readonly userId: string }) => props.userId,
    });

    let state: string | undefined;
    let value: string | undefined;
    let resume: (() => void) | undefined;
    let affected = 0;
    function Probe() {
      const query = useResultQuery(client2.guarded, { id: "a" }, { retry: false });
      const active = AuthShell.useHeld();
      state = query.state;
      if (query.state === "success") value = query.value;
      resume = active.resume;
      affected = active.affected;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <AuthShell.Provider userId="u_1">
                <Probe />
              </AuthShell.Provider>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    // held: the expired session paused the query
    expect(state).toBe("pending");
    expect(affected).toBe(1);

    // fix the condition, then resume
    sessionValid = true;
    await act(async () => {
      resume!();
      await settle();
    });
    expect(state).toBe("success");
    expect(value).toBe("data:a");
    expect(affected).toBe(0); // holdings cleared once the retry succeeded
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("teardown: unmounting a holding shell releases everything, and a remount starts clean", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const seen: string[] = [];
    const AuthShell = defineShell({
      name: "teardown-auth",
      from: DefectShell,
      claims: authErrors,
      onError: (failure) => seen.push(failure._tag),
      provide: (props: { readonly userId: string }) => props.userId,
    });

    function Probe() {
      useResultQuery(client.trip, { id: "expired" });
      return null;
    }
    const tree = (
      <ResultRpcProvider runtime={runtime}>
        <AppShell.Provider>
          <DefectShell.Provider>
            <AuthShell.Provider userId="u_1">
              <Probe />
            </AuthShell.Provider>
          </DefectShell.Provider>
        </AppShell.Provider>
      </ResultRpcProvider>
    );

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(tree);
      await settle();
    });
    expect(seen).toEqual(["auth/session-expired"]);
    // unmount while holding: releases cleanly, no re-fire, no leak
    await act(async () => renderer!.unmount());
    expect(seen).toEqual(["auth/session-expired"]);

    // a fresh mount is a fresh world: the cached failure is re-claimed (from
    // cache, and again when the stale refetch produces a new error value —
    // onError is once per newly claimed error and must be idempotent)
    await act(async () => {
      renderer = create(tree);
      await settle();
    });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen)).toEqual(new Set(["auth/session-expired"]));
    await act(async () => renderer!.unmount());
    runtime.clear();
  });
});

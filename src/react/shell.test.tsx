import { describe, expect, test } from "bun:test";
import { Component, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { defectErrors, err, error, ok, transportErrors, wire } from "../index.js";
import { createClient } from "../client/client.js";
import { fetchTransport, type ClientTransport } from "../client/transport.js";
import { createQueryRuntime } from "../query/runtime.js";
import { createFetchHandler, rpc } from "../server/index.js";
import { ResultRpcProvider, defineShell, useResultQuery } from "./index.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SessionExpired = error({
  tag: "auth/session-expired",
  data: wire.object({}),
  httpStatus: 401,
  retry: "never",
  visibility: "public",
});

const TripNotFound = error({
  tag: "trip/not-found",
  data: wire.object({ tripId: wire.string }),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
});

const authErrors = { SessionExpired } as const;

const r = rpc.context<{}>();
const trip = r.procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ SessionExpired, TripNotFound })
  .query(({ input, errors }) => {
    if (input.id === "expired") return err(errors.SessionExpired({}));
    if (input.id === "missing") return err(errors.TripNotFound({ tripId: input.id }));
    if (input.id === "boom") throw new Error("handler defect");
    return ok(input.id);
  });
const router = r.router({ trip });
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

const clientFor = (transport: ClientTransport) => createClient({ router, transport });

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// app shell: transport failures pause and feed one aggregate banner
const AppShell = defineShell({
  name: "app",
  handle: transportErrors,
  effect: "pause",
});

// defect shell: nothing renders a branch for these
const DefectShell = defineShell({
  name: "defect",
  from: AppShell,
  handle: defectErrors,
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
  test("unclaimed domain errors stay in the component union", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    const AuthShell = defineShell({
      name: "auth",
      from: DefectShell,
      handle: authErrors,
      provide: (props: { readonly userId: string }) => props.userId,
    });

    let tag: string | undefined;
    function Probe() {
      const query = AuthShell.useQuery(client.trip, { id: "missing" });
      if (query.state === "failure") tag = query.result.error._tag;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <AuthShell.Provider userId="u_1"><Probe /></AuthShell.Provider>
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
      handle: authErrors,
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
      affected = AuthShell.useActive().affected;
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
              <AuthShell.Provider userId="u_1"><Probe /></AuthShell.Provider>
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
      const active = AppShell.useActive();
      affected = active.affected;
      activeTag = active.active?._tag;
      state = query.state;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider><Probe /></AppShell.Provider>
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
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });

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
              <Boundary><Probe /></Boundary>
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

  test("a tag can only be claimed once per chain", () => {
    expect(() => defineShell({
      name: "duplicate",
      from: AppShell,
      handle: transportErrors,
    })).toThrow(/already claimed by app/);
  });

  test("a shell must be mounted inside its parent", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    let caught: unknown;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <Boundary onCaught={(value) => { caught = value; }}>
            <DefectShell.Provider><span>mounted</span></DefectShell.Provider>
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
      handle: authErrors,
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
      affected = AuthShell.useActive().affected;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <AuthShell.Provider userId="u_9"><Probe /></AuthShell.Provider>
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

  test("outside any shell, plain hooks surface the full union unchanged", async () => {
    const client = clientFor(httpTransport);
    const runtime = createQueryRuntime({ client });
    let tag: string | undefined;
    function Probe() {
      const query = useResultQuery(client.trip, { id: "expired" });
      if (query.state === "failure") tag = query.result.error._tag;
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}><Probe /></ResultRpcProvider>,
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
          <Boundary onCaught={(value) => { caught = value; }}><Probe /></Boundary>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(String((caught as Error).message)).toContain("is not mounted");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });
});

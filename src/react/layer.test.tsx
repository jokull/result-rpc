import { describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  defectErrors,
  defineLayer,
  err,
  error,
  ok,
  transportErrors,
  wire,
} from "../index.js";
import { createClient } from "../client/client.js";
import { fetchTransport } from "../client/transport.js";
import { createQueryRuntime } from "../query/runtime.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { ResultRpcProvider, defineShell, layerShell } from "./index.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const Unauthorized = error({
  tag: "auth/unauthorized",
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

// shared declaration: value, key, and union in one place
const AuthLayer = defineLayer({
  name: "auth",
  key: "user",
  provides: wire.object({ id: wire.string, email: wire.string }),
  errors: { Unauthorized },
});

interface AppContext {
  readonly sessionUserId: string | undefined;
}

const app = rpc.context<AppContext>();

// server: middleware derived from the layer
const authenticated = AuthLayer.middleware(app, async ({ context, errors }) =>
  context.sessionUserId === undefined
    ? err(errors.Unauthorized({}))
    : ok({ id: context.sessionUserId, email: `${context.sessionUserId}@example.test` }));

// shared: the context procedure contract, also derived
const whoamiContract = AuthLayer.contract(app);

// server: its implementation is the middleware's context value, nothing else
const whoami = AuthLayer.procedure(app, whoamiContract, authenticated);

const tripById = app.procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ Unauthorized, TripNotFound })
  .use(authenticated)
  .query(({ input, errors, context }) => {
    if (input.id === "missing") return err(errors.TripNotFound({ tripId: input.id }));
    return ok(`${input.id}:${context.user.id}`);
  });

const router = app.router({ auth: { whoami }, trip: { byId: tripById } });

const clientFor = (sessionUserId: string | undefined) => {
  const handler = createFetchHandler({
    router,
    createContext: () => ({ sessionUserId }),
  });
  const localFetch = ((input: string | URL | Request, init?: RequestInit) =>
    handler(new Request(input, init))) as typeof globalThis.fetch;
  return createClient({
    router,
    transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
  });
};

const AppShell = defineShell({
  name: "app-layer-test",
  handle: transportErrors,
  effect: "pause",
});

const DefectShell = defineShell({
  name: "defect-layer-test",
  from: AppShell,
  handle: defectErrors,
  effect: "pause",
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("layer factory", () => {
  test("one declaration derives middleware, context procedure, and shell", async () => {
    const client = clientFor("u_1");
    const runtime = createQueryRuntime({ client });
    const AuthShell = layerShell(AuthLayer, {
      from: DefectShell,
      procedure: client.auth.whoami,
    });

    let email: string | undefined;
    let tripTag: string | undefined;
    let tripValue: string | undefined;
    function Probe() {
      email = AuthShell.use().email;
      const trip = AuthShell.useQuery(client.trip.byId, { id: "trip_9" });
      if (trip.state === "failure") tripTag = trip.result.error._tag;
      if (trip.state === "success") tripValue = trip.result.value;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <AuthShell.Provider fallback={<span>establishing</span>}>
                <Probe />
              </AuthShell.Provider>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    // the guaranteed value came over the wire through the derived procedure
    expect(email).toBe("u_1@example.test");
    // the middleware ran under the trip procedure too and shaped its output
    expect(tripValue).toBe("trip_9:u_1");
    expect(tripTag).toBeUndefined();
    expect(AuthShell.handledTags).toContain("auth/unauthorized");
    expect(AuthShell.handledTags).toContain("client/offline");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a failed establishment renders the fallback and reaches onError", async () => {
    const client = clientFor(undefined);
    const runtime = createQueryRuntime({ client });
    const seen: string[] = [];
    const AuthShell = layerShell(AuthLayer, {
      from: DefectShell,
      procedure: client.auth.whoami,
      onError: (failure) => seen.push(failure._tag),
    });

    let probed = false;
    function Probe() {
      probed = true;
      AuthShell.use();
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <AuthShell.Provider fallback={<span>signed-out</span>}>
                <Probe />
              </AuthShell.Provider>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(probed).toBe(false);
    expect(seen).toEqual(["auth/unauthorized"]);
    expect(JSON.stringify(renderer?.toJSON())).toContain("signed-out");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("layer shells chain: a child shell can use the derived shell as from", async () => {
    const client = clientFor("u_2");
    const runtime = createQueryRuntime({ client });
    const AuthShell = layerShell(AuthLayer, {
      from: DefectShell,
      procedure: client.auth.whoami,
    });
    const TripShell = defineShell({
      name: "trip-layer-test",
      from: AuthShell,
      handle: { TripNotFound },
    });

    let state: string | undefined;
    function Probe() {
      const trip = TripShell.useQuery(client.trip.byId, { id: "missing" });
      state = trip.state;
      // trip/not-found is claimed by TripShell, so failure is unreachable here
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <AuthShell.Provider>
                <TripShell.Provider>
                  <Probe />
                </TripShell.Provider>
              </AuthShell.Provider>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(state).toBe("pending");
    expect(TripShell.handledTags).toContain("auth/unauthorized");
    expect(TripShell.handledTags).toContain("trip/not-found");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("an optional layer refines into a required layer with a growing context", async () => {
    const UserCodec = wire.object({ id: wire.string });
    const NullableUserCodec = wire.union([UserCodec, wire.null] as const);

    // optional: always establishes, claims nothing
    const SessionLayer = defineLayer({
      name: "session",
      key: "viewer",
      provides: NullableUserCodec,
      errors: {},
    });

    // required: narrows viewer from User | null to User, owns the union
    const ViewerLayer = SessionLayer.require({
      name: "viewer",
      provides: UserCodec,
      errors: { Unauthorized },
      refine: ({ value, errors }) =>
        value === null ? err(errors.Unauthorized({})) : ok(value),
    });

    interface CookieContext {
      readonly cookieUserId: string | undefined;
    }
    const cookieApp = rpc.context<CookieContext>();
    const session = SessionLayer.middleware(cookieApp, ({ context }) =>
      ok(context.cookieUserId === undefined ? null : { id: context.cookieUserId }));
    const requireViewer = ViewerLayer.middleware(cookieApp);

    const sessionContract = SessionLayer.contract(cookieApp);
    const viewerContract = ViewerLayer.contract(cookieApp);
    const cookieRouter = cookieApp.router({
      session: SessionLayer.procedure(cookieApp, sessionContract, session),
      viewer: ViewerLayer.procedure(cookieApp, viewerContract, session, requireViewer),
      greet: cookieApp.procedure()
        .input(wire.object({}))
        .output(wire.string)
        .use(session)
        .use(requireViewer)
        // context.viewer is User here, not User | null
        .query(({ context }) => ok(`hi ${context.viewer.id}`)),
    });
    const cookieHandler = createFetchHandler({
      router: cookieRouter,
      createContext: () => ({ cookieUserId: "u_9" }),
    });
    const cookieFetch = ((input: string | URL | Request, init?: RequestInit) =>
      cookieHandler(new Request(input, init))) as typeof globalThis.fetch;
    const cookieClient = createClient({
      router: cookieRouter,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: cookieFetch }),
    });
    const runtime = createQueryRuntime({ client: cookieClient });

    const SessionShell = layerShell(SessionLayer, {
      from: DefectShell,
      procedure: cookieClient.session,
    });
    const ViewerShell = layerShell(ViewerLayer, {
      from: SessionShell,
      procedure: cookieClient.viewer,
    });

    let sessionViewer: { id: string } | null | undefined;
    let viewer: { id: string } | undefined;
    let greeting: string | undefined;
    function Probe() {
      sessionViewer = SessionShell.use();
      viewer = ViewerShell.use();
      const greet = ViewerShell.useQuery(cookieClient.greet, {});
      if (greet.state === "success") greeting = greet.result.value;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <SessionShell.Provider>
                <ViewerShell.Provider fallback={<span>signed-out</span>}>
                  <Probe />
                </ViewerShell.Provider>
              </SessionShell.Provider>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(sessionViewer).toEqual({ id: "u_9" });
    expect(viewer).toEqual({ id: "u_9" });
    expect(greeting).toBe("hi u_9");
    // the optional layer claims nothing; the required layer claims the union
    expect(SessionShell.ownTags).toEqual([]);
    expect(ViewerShell.handledTags).toContain("auth/unauthorized");
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a bundled middleware pulls its chain in once, deduplicated", async () => {
    const UserCodec = wire.object({ id: wire.string });
    const NullableUserCodec = wire.union([UserCodec, wire.null] as const);
    const SessionLayer = defineLayer({
      name: "session-c",
      key: "viewer",
      provides: NullableUserCodec,
      errors: {},
    });
    const ViewerLayer = SessionLayer.require({
      name: "viewer-c",
      provides: UserCodec,
      errors: { Unauthorized },
      refine: ({ value, errors }) =>
        value === null ? err(errors.Unauthorized({})) : ok(value),
    });

    let sessionRuns = 0;
    const cookieApp = rpc.context<{}>();
    const session = SessionLayer.middleware(cookieApp, () => {
      sessionRuns += 1;
      return ok({ id: "u_7" });
    });
    // the required middleware bundles its parent: one .use() pulls the chain
    const requireViewer = ViewerLayer.middleware(cookieApp, session);

    const cookieRouter = cookieApp.router({
      // only the bundled middleware is used; session comes along in order
      greet: cookieApp.procedure()
        .input(wire.object({}))
        .output(wire.string)
        .use(requireViewer)
        .query(({ context }) => ok(`hi ${context.viewer.id}`)),
      // explicit + bundled: session must still run exactly once per request
      both: cookieApp.procedure()
        .input(wire.object({}))
        .output(wire.string)
        .use(session)
        .use(requireViewer)
        .query(({ context }) => ok(`hey ${context.viewer.id}`)),
    });
    const cookieHandler = createFetchHandler({
      router: cookieRouter,
      createContext: () => ({}),
    });
    const cookieFetch = ((input: string | URL | Request, init?: RequestInit) =>
      cookieHandler(new Request(input, init))) as typeof globalThis.fetch;
    const cookieClient = createClient({
      router: cookieRouter,
      transport: fetchTransport({ url: "https://example.test/rpc", fetch: cookieFetch }),
    });

    const greeted = await cookieClient.greet({});
    expect(greeted).toEqual(ok("hi u_7"));
    expect(sessionRuns).toBe(1);

    const both = await cookieClient.both({});
    expect(both).toEqual(ok("hey u_7"));
    expect(sessionRuns).toBe(2); // once more, not twice more
  });

  test("sign back in: re-established layer value auto-resumes held operations", async () => {
    const UserCodec = wire.object({ id: wire.string });
    const NullableUserCodec = wire.union([UserCodec, wire.null] as const);
    const SessionLayer2 = defineLayer({
      name: "session-resume",
      key: "viewer",
      provides: NullableUserCodec,
      errors: {},
    });
    const ViewerLayer2 = SessionLayer2.require({
      name: "viewer-resume",
      provides: UserCodec,
      errors: { Unauthorized },
      refine: ({ value, errors }) =>
        value === null ? err(errors.Unauthorized()) : ok(value),
    });

    // mutable server-side session: starts valid, gets revoked, comes back
    let sessionUser: string | undefined = "u_5";
    let serial = 0;
    const app2 = rpc.context<{}>();
    const session2 = SessionLayer2.middleware(app2, () =>
      ok(sessionUser === undefined ? null : { id: sessionUser }));
    const authenticated2 = ViewerLayer2.middleware(app2, session2);
    const router2 = app2.router({
      me: ViewerLayer2.procedure(app2, authenticated2),
      secret: app2.procedure()
        .output(wire.string)
        .errors({ Unauthorized })
        .use(authenticated2)
        .query(({ context }) => ok(`secret #${++serial} for ${context.viewer.id}`)),
    });
    const handler2 = createFetchHandler({ router: router2, createContext: () => ({}) });
    const client2 = createClient({
      router: router2,
      transport: fetchTransport({
        url: "https://example.test/rpc",
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          handler2(new Request(input, init))) as typeof globalThis.fetch,
      }),
    });
    const runtime = createQueryRuntime({ client: client2 });
    const ViewerShell = layerShell(ViewerLayer2, {
      from: DefectShell,
      procedure: client2.me,
    });

    let state: string | undefined;
    let value: string | undefined;
    let refetchSecret: (() => Promise<unknown>) | undefined;
    function Probe() {
      const query = ViewerShell.useQuery(client2.secret, {}, { retry: false });
      state = query.state;
      if (query.state === "success") value = query.result.value;
      refetchSecret = query.refetch;
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ResultRpcProvider runtime={runtime}>
          <AppShell.Provider>
            <DefectShell.Provider>
              <ViewerShell.Provider fallback={<span>signing in…</span>}>
                <Probe />
              </ViewerShell.Provider>
            </DefectShell.Provider>
          </AppShell.Provider>
        </ResultRpcProvider>,
      );
      await settle();
    });
    expect(state).toBe("success");
    expect(value).toBe("secret #1 for u_5");

    // revoke mid-session; the failed refetch is held by the shell — the stale
    // value keeps rendering instead of blanking or failing
    sessionUser = undefined;
    await act(async () => {
      await refetchSecret!().catch(() => undefined);
      await settle();
    });
    expect(state).toBe("success");
    expect(value).toBe("secret #1 for u_5"); // stale, held

    // sign back in and re-establish the layer value — no manual resume call
    sessionUser = "u_5";
    await act(async () => {
      await runtime.cache.invalidate(client2.me, {});
      await settle();
    });
    expect(state).toBe("success");
    expect(value).toBe("secret #2 for u_5"); // fresh fetch proves auto-resume ran
    await act(async () => renderer?.unmount());
    runtime.clear();
  });

  test("a refinement that cannot fail is rejected", () => {
    const SessionLayer = defineLayer({
      name: "session-b",
      key: "viewer",
      provides: wire.union([wire.object({}), wire.null] as const),
      errors: {},
    });
    expect(() => SessionLayer.require({
      name: "viewer-b",
      provides: wire.object({}),
      errors: {},
      refine: ({ value }) => ok(value ?? {}),
    })).toThrow(/cannot fail is the parent layer/);
  });
});

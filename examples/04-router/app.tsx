/**
 * Rung 4: routes ARE shells.
 *
 * TanStack Router + result-rpc, reusing rung 3's server. The mapping:
 *
 *   root route        ResultRpcProvider + AppShell + DefectShell
 *   errorComponent    the escalate target for defects
 *   pathless layout   SessionShell (public) and ViewerShell (authed)
 *   /trips/$tripId    TripShell claims trip/not-found for the route
 *
 * Everything is defined at module level — shells use the selector form of
 * `procedure:` and resolve the client through the provider at render time.
 * Navigation reactions close over the router singleton, exactly like any
 * TanStack Router app.
 */
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { defectErrors, errorCatalog, transportErrors } from "../../src/index.js";
import {
  createQueryRuntime,
  defineShell,
  layerShell,
  ResultRpcProvider,
  useResultClient,
} from "../../src/react/index.js";
import type { QueryRuntime } from "../../src/react/index.js";
import { SessionLayer, TripLocked, TripNotFound, ViewerLayer } from "../03-trips/domain.js";
import type { TripClient } from "../03-trips/ui.js";

// -- shells: module level, no client instance needed --------------------------------

export const AppShell = defineShell({
  name: "router-app",
  handle: transportErrors,
  effect: "pause",
});

export const DefectShell = defineShell({
  name: "router-defect",
  from: AppShell,
  handle: defectErrors,
  effect: "escalate",
});

export const SessionShell = layerShell(SessionLayer, {
  from: DefectShell,
  procedure: (client: TripClient) => client.auth.whoami,
});

export const ViewerShell = layerShell(ViewerLayer, {
  from: SessionShell,
  procedure: (client: TripClient) => client.auth.me,
  onError: () => void router.navigate({ to: "/signed-out" }),
});

export const TripShell = defineShell({
  name: "router-trip",
  from: ViewerShell,
  handle: { TripNotFound },
  effect: "pause",
});

// -- routes ---------------------------------------------------------------------------

interface RouterContext {
  readonly client: TripClient;
  readonly runtime: QueryRuntime;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <AppShell.Provider>
      <DefectShell.Provider>
        <ConnectivityBanner />
        <Outlet />
      </DefectShell.Provider>
    </AppShell.Provider>
  ),
  errorComponent: ({ error }) => (
    <p role="alert">Broken: {(error as { _tag?: string })._tag ?? "unknown"}</p>
  ),
});

/** Pathless layout: everything below renders with a session (maybe null). */
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "session",
  /** Each layout's loader warms its layer's context procedure. */
  loader: ({ context }) => context.runtime.prefetch(context.client.auth.whoami, {}),
  component: () => (
    <SessionShell.Provider fallback={<p>starting…</p>}>
      <Header />
      <Outlet />
    </SessionShell.Provider>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: "/",
  component: () => <p>Public home</p>,
});

const signedOutRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: "/signed-out",
  component: () => <p>You were signed out.</p>,
});

/** Pathless layout: everything below is guaranteed a viewer. */
const authedRoute = createRoute({
  getParentRoute: () => sessionRoute,
  id: "authed",
  loader: ({ context }) => context.runtime.prefetch(context.client.auth.me, {}),
  component: () => (
    <ViewerShell.Provider fallback={<p>signing in…</p>}>
      <Outlet />
    </ViewerShell.Provider>
  ),
});

const tripRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/trips/$tripId",
  /** Warm the cache before the route commits; failures surface on render, owned by the shells. */
  loader: async ({ context, params }) => {
    await context.runtime.prefetch(context.client.trip.byId, { id: params.tripId });
  },
  component: TripRoutePage,
});

function TripRoutePage() {
  const { tripId } = tripRoute.useParams();
  return (
    <TripShell.Provider>
      <TripMissing />
      <TripDetail tripId={tripId} />
    </TripShell.Provider>
  );
}

const routeTree = rootRoute.addChildren([
  sessionRoute.addChildren([indexRoute, signedOutRoute, authedRoute.addChildren([tripRoute])]),
]);

/**
 * One world per app startup (or per test): client, runtime, router. Navigation
 * reactions close over the live `router` binding, as in any TanStack Router app.
 */
export let router: ReturnType<typeof buildRouter>;

const buildRouter = (context: RouterContext, initialPath: string) =>
  createRouter({
    routeTree,
    context,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    defaultPendingMinMs: 0,
  });

export const makeWorld = (client: TripClient, initialPath = "/") => {
  const runtime = createQueryRuntime({ client });
  router = buildRouter({ client, runtime }, initialPath);
  return { client, runtime, router };
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof buildRouter>;
  }
}

// -- components -------------------------------------------------------------------------

function ConnectivityBanner() {
  const { active, affected } = AppShell.useActive();
  return active ? <div role="alert">Reconnecting… ({affected})</div> : null;
}

function Header() {
  const viewer = SessionShell.use();
  return <header>{viewer ? `Hi ${viewer.name}` : "Hi guest"}</header>;
}

function TripMissing() {
  const { active } = TripShell.useActive();
  return active ? <p role="alert">No trip named {active.data.tripId}.</p> : null;
}

const renameMessages = errorCatalog({ TripLocked }, {
  "trip/locked": (failure) => `Locked by ${failure.data.lockedBy}`,
});

function TripDetail({ tripId }: { tripId: string }) {
  const client = useResultClient<TripClient>();
  const viewer = ViewerShell.use();
  const trip = TripShell.useQuery(client.trip.byId, { id: tripId });
  const rename = TripShell.useMutation(client.trip.rename);

  if (trip.state !== "success") return <p>Loading…</p>;
  return (
    <article>
      <h1>{trip.result.value.title}</h1>
      <p>Viewer: {viewer.name}</p>
      <button onClick={() => void rename.mutate({ id: tripId, title: "Renamed" })}>
        Rename
      </button>
      {rename.state === "failure" && (
        <p role="alert">{renameMessages(rename.result.error)}</p>
      )}
    </article>
  );
}

// -- app ---------------------------------------------------------------------------------

export function RouterApp({ world }: { world: ReturnType<typeof makeWorld> }) {
  return (
    <ResultRpcProvider runtime={world.runtime}>
      <RouterProvider router={world.router} />
    </ResultRpcProvider>
  );
}

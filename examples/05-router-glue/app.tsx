/**
 * Rung 5: rung 4 rebuilt on ~60 lines of app-owned glue (router-glue.tsx).
 *
 * One declaration per layer produces both halves — the shell (union narrowing,
 * failure ownership) and the route fragment (provider component +
 * context-procedure prefetch loader) — without result-rpc knowing routers
 * exist. Compare with examples/04-router: no hand-written Provider nesting, no
 * hand-written prefetch loaders, no runtime wiring.
 */
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
} from "@tanstack/react-router";
import { defectErrors, errorCatalog, transportErrors } from "../../src/index.js";
import { defineShell, layerShell, useResultClient } from "../../src/react/index.js";
import {
  createResultRouter,
  ResultRouterProvider,
  routeShell,
  type ResultRouterContext,
} from "./router-glue.js";
import { SessionLayer, TripLocked, TripNotFound, ViewerLayer } from "../03-trips/domain.js";
import type { TripClient } from "../03-trips/ui.js";

// -- shells: one chain, defined at module level ----------------------------------------

export const AppShell = defineShell({
  name: "fw-app",
  handle: transportErrors,
  effect: "pause",
});

export const DefectShell = defineShell({
  name: "fw-defect",
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
  onError: () => void world.router.navigate({ to: "/signed-out" }),
});

export const TripShell = defineShell({
  name: "fw-trip",
  from: ViewerShell,
  handle: { TripNotFound },
});

// -- routes: each shell is spread straight into its route --------------------------------

const rootRoute = createRootRouteWithContext<ResultRouterContext<TripClient>>()({
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

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "session",
  ...routeShell(SessionShell, {
    pending: <p>starting…</p>,
    layout: (outlet) => (
      <>
        <Header />
        {outlet}
      </>
    ),
  }),
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

const authedRoute = createRoute({
  getParentRoute: () => sessionRoute,
  id: "authed",
  ...routeShell(ViewerShell, { pending: <p>signing in…</p> }),
});

const tripRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/trips/$tripId",
  loader: ({ context, params }) =>
    context.runtime.prefetch(context.client.trip.byId, { id: params.tripId }),
  ...routeShell(TripShell, {
    layout: (outlet) => (
      <>
        <TripMissing />
        {outlet}
      </>
    ),
    component: TripDetail,
  }),
});

const routeTree = rootRoute.addChildren([
  sessionRoute.addChildren([indexRoute, signedOutRoute, authedRoute.addChildren([tripRoute])]),
]);

// -- world --------------------------------------------------------------------------------

const buildRouter = (context: ResultRouterContext<TripClient>, initialPath: string) =>
  createRouter({
    routeTree,
    context,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    defaultPendingMinMs: 0,
  });

export let world: {
  client: TripClient;
  runtime: ResultRouterContext["runtime"];
  router: ReturnType<typeof buildRouter>;
};

export const makeWorld = (client: TripClient, initialPath = "/") =>
  (world = createResultRouter({
    client,
    router: (context) => buildRouter(context, initialPath),
  }));

// NOTE: rung 4 already claims the global Register augmentation; this example's
// router is used through its concrete type instead.

export const FrameworkApp = () => <ResultRouterProvider world={world} />;

// -- components -----------------------------------------------------------------------------

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

function TripDetail() {
  const { tripId } = tripRoute.useParams();
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

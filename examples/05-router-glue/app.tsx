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
import { errorCatalog } from "../../src/index.js";
import { boundaryShells, defineShell, layerShell, useResultClient } from "../../src/react/index.js";
import {
  createResultRouter,
  ResultRouterProvider,
  routeShell,
  type ResultRouterContext,
} from "./router-glue.js";
import { SessionLayer, DocForbidden, DocLocked, DocNotFound, ViewerLayer } from "../03-docs/domain.js";
import type { DocClient } from "../03-docs/ui.js";

// -- shells: one chain, defined at module level ----------------------------------------

export const { TransportShell, StaleShell, BoundaryProvider } = boundaryShells();

export const SessionShell = layerShell(SessionLayer, {
  from: StaleShell,
  procedure: (client: DocClient) => client.auth.whoami,
});

export const ViewerShell = layerShell(ViewerLayer, {
  from: SessionShell,
  procedure: (client: DocClient) => client.auth.me,
  onError: () => void world.router.navigate({ to: "/signed-out" }),
});

export const DocShell = defineShell({
  name: "fw-doc",
  from: ViewerShell,
  claims: { DocNotFound },
});

// -- routes: each shell is spread straight into its route --------------------------------

const rootRoute = createRootRouteWithContext<ResultRouterContext<DocClient>>()({
  component: () => (
    <BoundaryProvider>
        <ConnectivityBanner />
        <Outlet />
    </BoundaryProvider>
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

const docRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/docs/$docId",
  loader: ({ context, params }) =>
    context.runtime.prefetch(context.client.doc.byId, { id: params.docId }),
  ...routeShell(DocShell, {
    layout: (outlet) => (
      <>
        <DocMissing />
        {outlet}
      </>
    ),
    component: DocDetail,
  }),
});

const routeTree = rootRoute.addChildren([
  sessionRoute.addChildren([indexRoute, signedOutRoute, authedRoute.addChildren([docRoute])]),
]);

// -- world --------------------------------------------------------------------------------

const buildRouter = (context: ResultRouterContext<DocClient>, initialPath: string) =>
  createRouter({
    routeTree,
    context,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    defaultPendingMinMs: 0,
  });

export let world: {
  client: DocClient;
  runtime: ResultRouterContext["runtime"];
  router: ReturnType<typeof buildRouter>;
};

export const makeWorld = (client: DocClient, initialPath = "/") =>
  (world = createResultRouter({
    client,
    router: (context) => buildRouter(context, initialPath),
  }));

// NOTE: rung 4 already claims the global Register augmentation; this example's
// router is used through its concrete type instead.

export const FrameworkApp = () => <ResultRouterProvider world={world} />;

// -- components -----------------------------------------------------------------------------

function ConnectivityBanner() {
  const { latest, affected } = TransportShell.useHeld();
  return latest ? <div role="alert">Reconnecting… ({affected})</div> : null;
}

function Header() {
  const viewer = SessionShell.use();
  return <header>{viewer ? `Hi ${viewer.name}` : "Hi guest"}</header>;
}

function DocMissing() {
  const { latest } = DocShell.useHeld();
  return latest ? <p role="alert">No doc named {latest.data.docId}.</p> : null;
}

const renameMessages = errorCatalog({ DocLocked, DocForbidden }, {
  "doc/locked": (failure) => `Locked by ${failure.data.lockedBy}`,
  "doc/forbidden": () => "Only the owner can rename this doc",
});

function DocDetail() {
  const { docId } = docRoute.useParams();
  const client = useResultClient<DocClient>();
  const viewer = ViewerShell.use();
  const doc = DocShell.useQuery(client.doc.byId, { id: docId });
  const rename = DocShell.useMutation(client.doc.rename);

  if (doc.state !== "success") return <p>Loading…</p>;
  return (
    <article>
      <h1>{doc.result.value.title}</h1>
      <p>Viewer: {viewer.name}</p>
      <button onClick={() => void rename.mutate({ id: docId, title: "Renamed" })}>
        Rename
      </button>
      {rename.state === "failure" && (
        <p role="alert">{renameMessages(rename.result.error)}</p>
      )}
    </article>
  );
}

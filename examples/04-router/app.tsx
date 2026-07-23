/**
 * Rung 4: routes ARE shells.
 *
 * TanStack Router + result-rpc, reusing rung 3's server. The mapping:
 *
 *   root route        ResultRpcProvider + AppShell + DefectShell
 *   errorComponent    the escalate target for defects
 *   pathless layout   SessionShell (public) and ViewerShell (authed)
 *   /docs/$docId    DocShell claims doc/not-found for the route
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
import { SessionLayer, DocForbidden, DocLocked, DocNotFound, ViewerLayer } from "../03-docs/domain.js";
import type { DocClient } from "../03-docs/ui.js";

// -- shells: module level, no client instance needed --------------------------------

export const AppShell = defineShell({
  name: "router-app",
  claims: transportErrors,
  effect: "pause",
});

export const DefectShell = defineShell({
  name: "router-defect",
  from: AppShell,
  claims: defectErrors,
  effect: "escalate",
});

export const SessionShell = layerShell(SessionLayer, {
  from: DefectShell,
  procedure: (client: DocClient) => client.auth.whoami,
});

export const ViewerShell = layerShell(ViewerLayer, {
  from: SessionShell,
  procedure: (client: DocClient) => client.auth.me,
  onError: () => void router.navigate({ to: "/signed-out" }),
});

export const DocShell = defineShell({
  name: "router-doc",
  from: ViewerShell,
  claims: { DocNotFound },
  effect: "pause",
});

// -- routes ---------------------------------------------------------------------------

interface RouterContext {
  readonly client: DocClient;
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

const docRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/docs/$docId",
  /** Warm the cache before the route commits; failures surface on render, owned by the shells. */
  loader: async ({ context, params }) => {
    await context.runtime.prefetch(context.client.doc.byId, { id: params.docId });
  },
  component: DocRoutePage,
});

function DocRoutePage() {
  const { docId } = docRoute.useParams();
  return (
    <DocShell.Provider>
      <DocMissing />
      <DocDetail docId={docId} />
    </DocShell.Provider>
  );
}

const routeTree = rootRoute.addChildren([
  sessionRoute.addChildren([indexRoute, signedOutRoute, authedRoute.addChildren([docRoute])]),
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

export const makeWorld = (client: DocClient, initialPath = "/") => {
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
  const { latest, affected } = AppShell.useHeld();
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

function DocDetail({ docId }: { docId: string }) {
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

// -- app ---------------------------------------------------------------------------------

export function RouterApp({ world }: { world: ReturnType<typeof makeWorld> }) {
  return (
    <ResultRpcProvider runtime={world.runtime}>
      <RouterProvider router={world.router} />
    </ResultRpcProvider>
  );
}

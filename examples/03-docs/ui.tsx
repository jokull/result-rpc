/**
 * Rung 3, client: the full onion.
 *
 *   AppShell      transport failures pause → one connectivity banner
 *   DefectShell   protocol/internal defects escalate → error boundary
 *   SessionShell  provides User | null (public pages render inside this)
 *   ViewerShell   narrows to User, owns the auth union → sign-in redirect
 *   DocShell     feature layer: claims doc/not-found → route-level missing page
 *
 * The payoff: `rename` declares Unauthorized | DocNotFound | DocLocked plus
 * six transport tags — and the form below branches on exactly one: DocLocked.
 */
import { Component, type ReactNode } from "react";
import { defectErrors, errorCatalog, transportErrors } from "../../src/index.js";
import { createClient, fetchTransport } from "../../src/client/index.js";
import { defineShell, layerShell, ResultRpcProvider } from "../../src/react/index.js";
import { SessionLayer, DocLocked, DocNotFound, ViewerLayer } from "./domain.js";
import { docRouter } from "./server.js";

// -- client -----------------------------------------------------------------------

export const makeDocClient = (fetch: typeof globalThis.fetch) =>
  createClient({
    router: docRouter,
    transport: fetchTransport({ url: "https://example.test/rpc", fetch }),
  });
export type DocClient = ReturnType<typeof makeDocClient>;

// -- the onion ----------------------------------------------------------------------

export const AppShell = defineShell({
  name: "docs-app",
  claims: transportErrors,
  effect: "pause",
});

export const DefectShell = defineShell({
  name: "docs-defect",
  from: AppShell,
  claims: defectErrors,
  effect: "escalate",
});

export const makeShells = (client: DocClient, onSignIn: () => void) => {
  const SessionShell = layerShell(SessionLayer, {
    from: DefectShell,
    procedure: client.auth.whoami,
  });
  const ViewerShell = layerShell(ViewerLayer, {
    from: SessionShell,
    procedure: client.auth.me,
    onError: onSignIn,
  });
  const DocShell = defineShell({
    name: "doc-route",
    from: ViewerShell,
    claims: { DocNotFound },
    effect: "pause",
  });
  return { SessionShell, ViewerShell, DocShell };
};
export type Shells = ReturnType<typeof makeShells>;

// -- app ------------------------------------------------------------------------------

export function DocsApp({ client, shells, docId }: {
  client: DocClient;
  shells: Shells;
  docId: string;
}) {
  const { SessionShell, ViewerShell, DocShell } = shells;
  return (
    <ResultRpcProvider client={client}>
      <AppShell.Provider>
        <DefectShell.Provider>
          <Boundary>
            <ConnectivityBanner />
            <SessionShell.Provider fallback={<p>starting…</p>}>
              <Greeting shells={shells} />
              <ViewerShell.Provider fallback={<p>signing in…</p>}>
                <DocShell.Provider>
                  <DocMissingNotice shells={shells} />
                  <DocPage client={client} shells={shells} docId={docId} />
                </DocShell.Provider>
              </ViewerShell.Provider>
            </SessionShell.Provider>
          </Boundary>
        </DefectShell.Provider>
      </AppShell.Provider>
    </ResultRpcProvider>
  );
}

function ConnectivityBanner() {
  const { latest, affected } = AppShell.useHeld();
  return latest ? <div role="alert">Reconnecting… ({affected})</div> : null;
}

/** Public: renders for signed-out visitors too — the session value is nullable here. */
function Greeting({ shells }: { shells: Shells }) {
  const viewer = shells.SessionShell.use();
  return <header>{viewer ? `Welcome back, ${viewer.name}` : "Welcome, guest"}</header>;
}

/** The route-level owner of doc/not-found. */
function DocMissingNotice({ shells }: { shells: Shells }) {
  const { latest } = shells.DocShell.useHeld();
  if (!latest) return null;
  return <p role="alert">Doc {latest.data.docId} does not exist.</p>;
}

// -- the page ------------------------------------------------------------------------

const renameMessages = errorCatalog({ DocLocked }, {
  "doc/locked": (failure) => `Locked by ${failure.data.lockedBy}`,
});

export function DocPage({ client, shells, docId }: {
  client: DocClient;
  shells: Shells;
  docId: string;
}) {
  const { DocShell, ViewerShell } = shells;
  const viewer = ViewerShell.use(); // User — guaranteed, not User | null
  const doc = DocShell.useQuery(client.doc.byId, { id: docId });

  const rename = DocShell.useMutation(client.doc.rename);
  // rename failure union here: DocLocked. Everything else is owned above.

  if (doc.state !== "success") return <p>Loading doc…</p>;

  return (
    <article>
      <h1>{doc.result.value.title}</h1>
      <p>Planned by {viewer.name}</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem("title") as HTMLInputElement;
        void rename.mutate({ id: docId, title: field.value });
      }}>
        <input name="title" defaultValue={doc.result.value.title} />
        {rename.state === "failure" && (
          <p role="alert">{renameMessages(rename.result.error)}</p>
        )}
      </form>
    </article>
  );
}

// -- defect boundary --------------------------------------------------------------------

class Boundary extends Component<{ children?: ReactNode }, { caught?: unknown }> {
  override state: { caught?: unknown } = {};
  static getDerivedStateFromError(caught: unknown) {
    return { caught };
  }
  override render() {
    if (this.state.caught === undefined) return this.props.children;
    const tag = (this.state.caught as { _tag?: string })._tag ?? "unknown";
    return <p role="alert">Something broke ({tag}). Reload to continue.</p>;
  }
}

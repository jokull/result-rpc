/**
 * Rung 3, client: the full onion.
 *
 *   boundaryShells()  the framework-owned rings, pre-assembled:
 *     TransportShell  transport failures pause → one connectivity banner
 *     DefectShell     protocol/internal defects escalate → error boundary
 *     StaleShell      a stale deploy reloads by default
 *   SessionShell      provides User | null (public pages render inside this)
 *   ViewerShell       narrows to User, owns the auth union → sign-in reaction
 *
 * The payoff: `doc.byId` resolves a dozen possible failures — and DocPage
 * switch-matches exactly one: `doc/not-found`. `doc.rename` resolves fourteen —
 * and the form branches on exactly its three domain outcomes. Every framework
 * tag is owned by a named shell above, and the type probes in app.test.tsx
 * assert both unions.
 *
 * Shells are module constants: `procedure:` takes a selector, resolved through
 * the mounted provider's client at render time, so nothing here needs a live
 * client to be declared.
 */
import { Component, type ReactNode } from "react";
import { defectErrors, errorCatalog } from "../../src/index.js";
import { createClient, fetchTransport } from "../../src/client/index.js";
import {
  boundaryShells,
  layerShell,
  ResultRpcProvider,
  useResultClient,
} from "../../src/react/index.js";
import { SessionLayer, DocForbidden, DocLocked, DocNotFound, ViewerLayer } from "./domain.js";
import { docRouter } from "./server.js";

// -- client -----------------------------------------------------------------------

export const makeDocClient = (fetch: typeof globalThis.fetch) =>
  createClient({
    router: docRouter,
    transport: fetchTransport({ url: "https://example.test/rpc", fetch }),
  });
export type DocClient = ReturnType<typeof makeDocClient>;

// -- the onion (module-level: no client required to declare it) ---------------------

/**
 * The framework-owned outer rings, pre-assembled: transport pauses, defects
 * escalate, a stale deploy reloads. User shells hang off StaleShell.
 */
export const { TransportShell, StaleShell, BoundaryProvider } = boundaryShells({
  name: "docs",
});

export const SessionShell = layerShell(SessionLayer, {
  from: StaleShell,
  procedure: (client: DocClient) => client.auth.whoami,
});

/** A real app redirects to /login here; tests observe the counter. */
export const signInReactions = { count: 0 };

export const ViewerShell = layerShell(ViewerLayer, {
  from: SessionShell,
  procedure: (client: DocClient) => client.auth.me,
  onError: () => {
    signInReactions.count += 1;
  },
});

// -- app ------------------------------------------------------------------------------

export function DocsApp({ client, docId }: { client: DocClient; docId: string }) {
  return (
    <ResultRpcProvider client={client}>
      <BoundaryProvider>
        <Boundary>
          <ConnectivityBanner />
          <SessionShell.Provider fallback={<p>starting…</p>}>
            <Greeting />
            <ViewerShell.Provider fallback={<p>signing in…</p>}>
              <DocPage docId={docId} />
              <DocActivity docId={docId} />
              <AvatarForm />
            </ViewerShell.Provider>
          </SessionShell.Provider>
        </Boundary>
      </BoundaryProvider>
    </ResultRpcProvider>
  );
}

function ConnectivityBanner() {
  const { latest, affected } = TransportShell.useHeld();
  return latest ? <div role="alert">Reconnecting… ({affected})</div> : null;
}

/** Public: renders for signed-out visitors too — the session value is nullable here. */
function Greeting() {
  const viewer = SessionShell.use();
  if (!viewer) return <header>Welcome, guest</header>;
  // avatarUrl updates HERE the instant setAvatar succeeds anywhere below:
  // the mutation returns the user entity, and this header's whoami query
  // contains user:{id} — patched in place, no refetch.
  return <header>Welcome back, {viewer.name} [{viewer.avatarUrl}]</header>;
}

/** The flagship: change the avatar, watch the header — zero refetches. */
export function AvatarForm() {
  const client = useResultClient<DocClient>();
  const setAvatar = ViewerShell.useMutation(client.auth.setAvatar);
  return (
    <button onClick={() =>
      void setAvatar.mutate({ avatarUrl: "v2.png" }).catch(() => undefined)}>
      Update avatar
    </button>
  );
}

// -- the page ------------------------------------------------------------------------

const renameMessages = errorCatalog({ DocNotFound, DocLocked, DocForbidden }, {
  "doc/not-found": () => "This doc was deleted while you were editing",
  "doc/locked": (failure) => `Locked by ${failure.data.lockedBy}`,
  "doc/forbidden": () => "Only the owner can rename this doc",
});

export function DocPage({ docId }: { docId: string }) {
  const client = useResultClient<DocClient>();
  const viewer = ViewerShell.use(); // User — guaranteed, not User | null
  const doc = ViewerShell.useQuery(client.doc.byId, { id: docId });

  const rename = ViewerShell.useMutation(client.doc.rename);
  // rename failure union here: exactly the three declared domain outcomes —
  // DocNotFound | DocLocked | DocForbidden. The framework tags are owned above.

  switch (doc.state) {
    case "pending":
      return <p>Loading doc…</p>;

    case "failure":
      // doc/not-found — the page's own domain error; anything else is a type error
      return <p role="alert">Doc {doc.result.error.data.docId} does not exist.</p>;

    case "success":
      return (
        <article>
          <h1>{doc.result.value.title}</h1>
          <p>Planned by {viewer.name}</p>
          <form onSubmit={(event) => {
            event.preventDefault();
            const field = event.currentTarget.elements.namedItem("title") as HTMLInputElement;
            // claimed/cancelled rejections are control flow, not outcomes
            void rename.mutate({ id: docId, title: field.value }).catch(() => undefined);
          }}>
            <input name="title" defaultValue={doc.result.value.title} />
            {rename.state === "failure" && (
              <p role="alert">{renameMessages(rename.result.error)}</p>
            )}
          </form>
        </article>
      );
  }
}

/** The same union, streaming: connection state lives beside the latest Result. */
function DocActivity({ docId }: { docId: string }) {
  const client = useResultClient<DocClient>();
  const events = ViewerShell.useSubscription(client.doc.events, { id: docId });
  if (!events.result?.ok) return null;
  return (
    <p>
      Last activity: {events.result.value.kind} on {events.result.value.at.toDateString()}
    </p>
  );
}

// -- defect boundary --------------------------------------------------------------------

const defectMessages = errorCatalog(defectErrors, {
  "client/http-failure": () => "The server answered outside the protocol.",
  "client/protocol-violation": () => "The server sent a malformed response.",
  "client/decode-failure": () => "The response did not match its contract.",
  "server/bad-request": () => "The request was malformed.",
  "server/internal": (failure) => `Server incident ${failure.data.incidentId}.`,
});

class Boundary extends Component<{ children?: ReactNode }, { caught?: unknown }> {
  override state: { caught?: unknown } = {};
  static getDerivedStateFromError(caught: unknown) {
    return { caught };
  }
  override render() {
    if (this.state.caught === undefined) return this.props.children;
    // escalated values are structural TaggedErrors, so the catalog still applies
    const message = defectMessages(this.state.caught as Parameters<typeof defectMessages>[0]);
    return <p role="alert">{message} Reload to continue.</p>;
  }
}

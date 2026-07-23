/**
 * Rung 3, client: the full onion.
 *
 *   AppShell      transport failures pause → one connectivity banner
 *   DefectShell   protocol/internal defects escalate → error boundary
 *   SessionShell  provides User | null (public pages render inside this)
 *   ViewerShell   narrows to User, owns the auth union → sign-in redirect
 *   TripShell     feature layer: claims trip/not-found → route-level missing page
 *
 * The payoff: `rename` declares Unauthorized | TripNotFound | TripLocked plus
 * six transport tags — and the form below branches on exactly one: TripLocked.
 */
import { Component, type ReactNode } from "react";
import { defectErrors, errorCatalog, transportErrors } from "../../src/index.js";
import { createClient, fetchTransport } from "../../src/client/index.js";
import { defineShell, layerShell, ResultRpcProvider } from "../../src/react/index.js";
import { SessionLayer, TripLocked, TripNotFound, ViewerLayer } from "./domain.js";
import { tripRouter } from "./server.js";

// -- client -----------------------------------------------------------------------

export const makeTripClient = (fetch: typeof globalThis.fetch) =>
  createClient({
    router: tripRouter,
    transport: fetchTransport({ url: "https://example.test/rpc", fetch }),
  });
export type TripClient = ReturnType<typeof makeTripClient>;

// -- the onion ----------------------------------------------------------------------

export const AppShell = defineShell({
  name: "trips-app",
  handle: transportErrors,
  effect: "pause",
});

export const DefectShell = defineShell({
  name: "trips-defect",
  from: AppShell,
  handle: defectErrors,
  effect: "escalate",
});

export const makeShells = (client: TripClient, onSignIn: () => void) => {
  const SessionShell = layerShell(SessionLayer, {
    from: DefectShell,
    procedure: client.auth.whoami,
  });
  const ViewerShell = layerShell(ViewerLayer, {
    from: SessionShell,
    procedure: client.auth.me,
    onError: onSignIn,
  });
  const TripShell = defineShell({
    name: "trip-route",
    from: ViewerShell,
    handle: { TripNotFound },
    effect: "pause",
  });
  return { SessionShell, ViewerShell, TripShell };
};
export type Shells = ReturnType<typeof makeShells>;

// -- app ------------------------------------------------------------------------------

export function TripsApp({ client, shells, tripId }: {
  client: TripClient;
  shells: Shells;
  tripId: string;
}) {
  const { SessionShell, ViewerShell, TripShell } = shells;
  return (
    <ResultRpcProvider client={client}>
      <AppShell.Provider>
        <DefectShell.Provider>
          <Boundary>
            <ConnectivityBanner />
            <SessionShell.Provider fallback={<p>starting…</p>}>
              <Greeting shells={shells} />
              <ViewerShell.Provider fallback={<p>signing in…</p>}>
                <TripShell.Provider>
                  <TripMissingNotice shells={shells} />
                  <TripPage client={client} shells={shells} tripId={tripId} />
                </TripShell.Provider>
              </ViewerShell.Provider>
            </SessionShell.Provider>
          </Boundary>
        </DefectShell.Provider>
      </AppShell.Provider>
    </ResultRpcProvider>
  );
}

function ConnectivityBanner() {
  const { active, affected } = AppShell.useActive();
  return active ? <div role="alert">Reconnecting… ({affected})</div> : null;
}

/** Public: renders for signed-out visitors too — the session value is nullable here. */
function Greeting({ shells }: { shells: Shells }) {
  const viewer = shells.SessionShell.use();
  return <header>{viewer ? `Welcome back, ${viewer.name}` : "Welcome, guest"}</header>;
}

/** The route-level owner of trip/not-found. */
function TripMissingNotice({ shells }: { shells: Shells }) {
  const { active } = shells.TripShell.useActive();
  if (!active) return null;
  return <p role="alert">Trip {active.data.tripId} does not exist.</p>;
}

// -- the page ------------------------------------------------------------------------

const renameMessages = errorCatalog({ TripLocked }, {
  "trip/locked": (failure) => `Locked by ${failure.data.lockedBy}`,
});

export function TripPage({ client, shells, tripId }: {
  client: TripClient;
  shells: Shells;
  tripId: string;
}) {
  const { TripShell, ViewerShell } = shells;
  const viewer = ViewerShell.use(); // User — guaranteed, not User | null
  const trip = TripShell.useQuery(client.trip.byId, { id: tripId });

  const rename = TripShell.useMutation(client.trip.rename);
  // rename failure union here: TripLocked. Everything else is owned above.

  if (trip.state !== "success") return <p>Loading trip…</p>;

  return (
    <article>
      <h1>{trip.result.value.title}</h1>
      <p>Planned by {viewer.name}</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem("title") as HTMLInputElement;
        void rename.mutate({ id: tripId, title: field.value });
      }}>
        <input name="title" defaultValue={trip.result.value.title} />
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

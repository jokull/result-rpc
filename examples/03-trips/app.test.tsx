import { expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createTripHandler } from "./server.js";
import { makeShells, makeTripClient, TripsApp, type Shells, type TripClient } from "./ui.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const boot = async (session?: string) => {
  const handler = await createTripHandler();
  const client = makeTripClient(((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (session) request.headers.set("x-session", session);
    return handler(request);
  }) as typeof globalThis.fetch);
  let signIns = 0;
  const shells = makeShells(client, () => {
    signIns += 1;
  });
  return { client, shells, signIns: () => signIns };
};

const mount = async (client: TripClient, shells: Shells, tripId: string) => {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<TripsApp client={client} shells={shells} tripId={tripId} />);
    await settle();
  });
  return renderer!;
};

test("03-trips: signed-in flow renders through every layer", async () => {
  const { client, shells } = await boot("tok_1");
  const renderer = await mount(client, shells, "trip_1");
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("Welcome back, Jokull"); // SessionShell value
  expect(html).toContain("Japan");                // TripShell query
  expect(html).toContain("Planned by ");          // ViewerShell guarantee
  await act(async () => renderer.unmount());
});

test("03-trips: renaming a locked trip surfaces exactly TripLocked", async () => {
  const { client, shells } = await boot("tok_1");
  const renderer = await mount(client, shells, "trip_2");
  const form = renderer.root.findByType("form");
  await act(async () => {
    form.props.onSubmit({
      preventDefault: () => undefined,
      currentTarget: { elements: { namedItem: () => ({ value: "Iceland 2027" }) } },
    });
    await settle();
  });
  expect(JSON.stringify(renderer.toJSON())).toContain("Locked by u_2");
  await act(async () => renderer.unmount());
});

test("03-trips: signed-out visitors see the public shell and the sign-in reaction", async () => {
  const { client, shells, signIns } = await boot(undefined);
  const renderer = await mount(client, shells, "trip_1");
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("Welcome, guest");   // SessionShell provides null
  expect(html).toContain("signing in…");      // ViewerShell fallback
  expect(html).not.toContain("Planned by");   // authed subtree never rendered
  expect(signIns()).toBe(1);                  // onError fired once
  await act(async () => renderer.unmount());
});

test("03-trips: a missing trip is owned by the route shell, not the page", async () => {
  const { client, shells } = await boot("tok_1");
  const renderer = await mount(client, shells, "trip_404");
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("does not exist.");
  expect(html).toContain("trip_404");
  expect(html).toContain("Loading trip…"); // page paused, not failed
  await act(async () => renderer.unmount());
});

test("03-trips: the subscription streams under the same union", async () => {
  const { client } = await boot("tok_1");
  const events: unknown[] = [];
  for await (const event of client.trip.events({ id: "trip_1" })) {
    events.push(event);
  }
  expect(events).toEqual([
    { ok: true, value: { tripId: "trip_1", kind: "renamed", at: new Date("2026-01-01") } },
  ]);
});

// -- compile-time: the narrowed unions are exactly what the prose claims -------------

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

declare const probeShells: Shells;
declare const probeClient: TripClient;
const probeRename = () => probeShells.TripShell.useMutation(probeClient.trip.rename);
type RenameState = ReturnType<typeof probeRename>;
type RenameError = Extract<RenameState, { state: "failure" }>["result"]["error"];
type _RenameIsOnlyTripLocked = Assert<Equal<RenameError["_tag"], "trip/locked">>;

const probeTrip = () => probeShells.TripShell.useQuery(probeClient.trip.byId, { id: "x" });
type TripQueryState = ReturnType<typeof probeTrip>;
type TripQueryError = Extract<TripQueryState, { state: "failure" }>["result"]["error"];
type _TripQueryHasNoFailures = Assert<Equal<TripQueryError, never>>;
void probeRename;
void probeTrip;

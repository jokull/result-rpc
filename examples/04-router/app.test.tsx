import { expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createTripHandler } from "../03-trips/server.js";
import { makeTripClient } from "../03-trips/ui.js";
import { makeWorld, router, RouterApp } from "./app.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const boot = async (session?: string) => {
  const handler = await createTripHandler();
  return makeTripClient(((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (session) request.headers.set("x-session", session);
    return handler(request);
  }) as typeof globalThis.fetch);
};

const mountAt = async (client: Awaited<ReturnType<typeof boot>>, path: string) => {
  const world = makeWorld(client, path);
  await world.router.load();
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<RouterApp world={world} />);
    await settle();
  });
  return { renderer: renderer!, world };
};

test("04-router: authed route renders the trip through the shell tree", async () => {
  const client = await boot("tok_1");
  const { renderer } = await mountAt(client, "/trips/trip_1");
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("Hi ");
  expect(html).toContain("Jokull");
  expect(html).toContain("Japan");
  await act(async () => renderer.unmount());
});

test("04-router: a missing trip is owned by the route shell", async () => {
  const client = await boot("tok_1");
  const { renderer } = await mountAt(client, "/trips/trip_404");
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("No trip named ");
  expect(html).toContain("trip_404");
  expect(html).toContain("Loading…");
  await act(async () => renderer.unmount());
});

test("04-router: signed-out visitors are redirected by the viewer shell", async () => {
  const client = await boot(undefined);
  const { renderer } = await mountAt(client, "/trips/trip_1");
  // ViewerShell.onError navigated the router away from the authed subtree.
  await act(async () => {
    await settle();
  });
  expect(router.state.location.pathname).toBe("/signed-out");
  // The un-redirected tree shows the public shell and the viewer fallback —
  // never the authed content:
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("Hi guest");
  expect(html).not.toContain("Viewer:");
  await act(async () => renderer.unmount());

  // react-test-renderer cannot flush the router's concurrent transition, so
  // assert the destination with a fresh mount at the redirected location.
  const world = makeWorld(client, "/signed-out");
  await world.router.load();
  let redirected: ReactTestRenderer | undefined;
  await act(async () => {
    redirected = create(<RouterApp world={world} />);
    await settle();
  });
  expect(JSON.stringify(redirected!.toJSON())).toContain("You were signed out.");
  await act(async () => redirected!.unmount());
});

test("04-router: loaders warm the whole layer cascade before first paint", async () => {
  const client = await boot("tok_1");
  const world = makeWorld(client, "/trips/trip_1");
  await world.router.load(); // loaders prefetch whoami, me, and the trip
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(<RouterApp world={world} />);
  });
  // No settle: the first committed paint already has session, viewer, and trip.
  const html = JSON.stringify(renderer!.toJSON());
  expect(html).toContain("Jokull");
  expect(html).toContain("Japan");
  expect(html).not.toContain("starting…");
  expect(html).not.toContain("signing in…");
  expect(html).not.toContain("Loading…");
  await act(async () => renderer!.unmount());
});

test("04-router: renaming a locked trip shows exactly the domain error", async () => {
  const client = await boot("tok_1");
  const { renderer } = await mountAt(client, "/trips/trip_2");
  const button = renderer.root.findByType("button");
  await act(async () => {
    button.props.onClick();
    await settle();
  });
  expect(JSON.stringify(renderer.toJSON())).toContain("Locked by u_2");
  await act(async () => renderer.unmount());
});

import { expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createTripHandler } from "../03-trips/server.js";
import { makeTripClient } from "../03-trips/ui.js";
import { FrameworkApp, makeWorld, world } from "./app.js";

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
  makeWorld(client, path);
  await world.router.load();
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<FrameworkApp />);
    await settle();
  });
  return renderer!;
};

test("05-framework: routeShell fragments render the full cascade", async () => {
  const client = await boot("tok_1");
  const renderer = await mountAt(client, "/trips/trip_1");
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("Jokull");
  expect(html).toContain("Japan");
  await act(async () => renderer.unmount());
});

test("05-framework: layer loaders come from routeShell — first paint has no fallbacks", async () => {
  const client = await boot("tok_1");
  makeWorld(client, "/trips/trip_1");
  await world.router.load(); // routeShell loaders prefetch whoami + me; route loader the trip
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(<FrameworkApp />);
  });
  const html = JSON.stringify(renderer!.toJSON());
  expect(html).toContain("Japan");
  expect(html).not.toContain("starting…");
  expect(html).not.toContain("signing in…");
  expect(html).not.toContain("Loading…");
  await act(async () => renderer!.unmount());
});

test("05-framework: missing trip pauses under the route's shell", async () => {
  const client = await boot("tok_1");
  const renderer = await mountAt(client, "/trips/trip_404");
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("No trip named ");
  expect(html).toContain("trip_404");
  expect(html).toContain("Loading…");
  await act(async () => renderer.unmount());
});

test("05-framework: signed-out visitors get redirected", async () => {
  const client = await boot(undefined);
  const renderer = await mountAt(client, "/trips/trip_1");
  await act(async () => {
    await settle();
  });
  expect(world.router.state.location.pathname).toBe("/signed-out");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Viewer:");
  await act(async () => renderer.unmount());
});

test("05-framework: locked rename shows exactly the domain error", async () => {
  const client = await boot("tok_1");
  const renderer = await mountAt(client, "/trips/trip_2");
  const button = renderer.root.findByType("button");
  await act(async () => {
    button.props.onClick();
    await settle();
  });
  expect(JSON.stringify(renderer.toJSON())).toContain("Locked by u_2");
  await act(async () => renderer.unmount());
});

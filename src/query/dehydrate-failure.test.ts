/**
 * A declared domain failure is the answer to a query, so it belongs in the
 * hydration payload.
 *
 * Reported by the first external adopter: a detail page for a row that does not
 * exist server-rendered an empty body and only said "not found" after a client
 * round-trip, because dehydration kept successes only. A transport failure is
 * different in kind — it describes one attempt on one machine — and must still
 * be left out.
 */
import { describe, expect, test } from "bun:test";
import { err, error, ok, wire } from "../index.js";
import { createFixtureClient } from "../testing/index.js";
import { fetchTransport, type ClientTransport } from "../client/transport.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { createQueryRuntime } from "./runtime.js";

const NotFound = error({
  tag: "theme/not-found",
  data: wire.object({ themeId: wire.string }),
  httpStatus: 404,
  retry: "never",
});

const app = rpc.context<{}>();
const byId = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.object({ id: wire.string, name: wire.string }))
  .errors({ NotFound })
  .query(({ input, errors }) =>
    input.id === "known"
      ? ok({ id: "known", name: "Kitty" })
      : err(errors.NotFound({ themeId: input.id })),
  );
const router = app.router({ byId });
const handler = createFetchHandler({ router, createContext: () => ({}) });

const httpClient = () =>
  createFixtureClient({
    router,
    transport: fetchTransport({
      url: "https://example.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof globalThis.fetch,
    }),
  });

/** Every call fails the way a dropped connection does. */
const offlineClient = () => {
  const transport: ClientTransport = { request: async () => ({ ok: false, reason: "offline" }) };
  return createFixtureClient({ router, transport });
};

describe("dehydrating a declared domain failure", () => {
  test("renders on first paint with no client request", async () => {
    const serverClient = httpClient();
    const runtime = createQueryRuntime({ client: serverClient });
    await runtime.prefetch(serverClient.byId, { id: "missing" });
    const payload = runtime.dehydrate();

    // A browser that never talks to the network still knows the answer.
    let requests = 0;
    const countingTransport: ClientTransport = {
      request: async () => {
        requests += 1;
        return { ok: false, reason: "offline" };
      },
    };
    const browserClient = createFixtureClient({ router, transport: countingTransport });
    const browser = createQueryRuntime({ client: browserClient });
    browser.hydrate(payload);
    const observer = browser.observe(browserClient.byId, { id: "missing" }, { staleTime: 60_000 });

    const state = observer.getCurrentState();
    expect(state.state).toBe("failure");
    expect(state.error?._tag).toBe("theme/not-found");
    expect(requests).toBe(0);

    // Reified, not a plain object: it must narrow and match like any wire error.
    expect(NotFound.is(state.error)).toBe(true);
    if (NotFound.is(state.error)) expect(state.error.data.themeId).toBe("missing");

    observer.destroy();
    browser.clear();
    runtime.clear();
  });

  test("a transport failure is still left out", async () => {
    // Baking one machine's dropped connection into the payload would replace a
    // fetch the client can retry with a verdict it cannot.
    const client = offlineClient();
    const runtime = createQueryRuntime({ client });
    await runtime.prefetch(client.byId, { id: "known" });
    const payload = runtime.dehydrate();

    const browserClient = httpClient();
    const browser = createQueryRuntime({ client: browserClient });
    browser.hydrate(payload);
    const observer = browser.observe(browserClient.byId, { id: "known" }, { staleTime: 60_000 });
    // Absent, so the browser fetches — not hydrated as a settled failure.
    expect(observer.getCurrentState().state).not.toBe("failure");

    observer.destroy();
    browser.clear();
    runtime.clear();
  });

  test("a successful prefetch still hydrates as before", async () => {
    const client = httpClient();
    const runtime = createQueryRuntime({ client });
    await runtime.prefetch(client.byId, { id: "known" });
    const payload = runtime.dehydrate();

    const browserClient = httpClient();
    const browser = createQueryRuntime({ client: browserClient });
    browser.hydrate(payload);
    const observer = browser.observe(browserClient.byId, { id: "known" }, { staleTime: 60_000 });
    expect(observer.getCurrentState()).toMatchObject({
      state: "success",
      value: { id: "known", name: "Kitty" },
    });

    observer.destroy();
    browser.clear();
    runtime.clear();
  });
});

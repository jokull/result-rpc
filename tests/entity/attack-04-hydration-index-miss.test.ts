/**
 * Attack 4: hydrated queries are invisible to the entity index until
 * individually observed.
 *
 * dehydrate() serializes plain data; brands live in a WeakMap keyed by
 * object identity, so hydrated results are UNBRANDED. hydrate() fires
 * 'added' events whose reindex collects nothing. observe() re-decodes
 * through the output codec (re-branding) — but only for the queries that
 * get observed. A mutation that fires between hydrate and observe patches
 * (and touch-invalidates) NOTHING for the not-yet-observed query, and a
 * later observe with a staleTime shows the pre-mutation snapshot as fresh
 * success — wrong data on screen with zero signals.
 */
import { describe, expect, test } from "bun:test";
import { ok, wire } from "../../src/index.js";
import { createFixtureClient } from "../../src/testing/index.js";
import { fetchTransport } from "../../src/client/transport.js";
import { createFetchHandler } from "../../src/server/index.js";
import { rpc } from "../../src/server/contract.js";
import { createQueryRuntime } from "../../src/query/runtime.js";
import { defineModel } from "../../src/model.js";
import { waitFor, sleep } from "./harness.js";

const User = defineModel("a04-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string, avatarUrl: wire.string },
});

const boot = () => {
  const app = rpc.context<{
    readonly db: { user: { id: string; name: string; avatarUrl: string } };
  }>();
  const me = app
    .procedure()
    .output(User.all("test fixture"))
    .query(({ context }) => ok(context.db.user));
  const profile = app
    .procedure()
    .output(User.all("test fixture"))
    .query(({ context }) => ok(context.db.user));
  const setAvatar = app
    .procedure()
    .input(wire.object({ avatarUrl: wire.string }))
    .output(User.all("test fixture"))
    .mutation(({ input, context }) => {
      context.db.user = { ...context.db.user, avatarUrl: input.avatarUrl };
      return ok(context.db.user);
    });
  const router = app.router({ me, profile, setAvatar });
  const db = { user: { id: "u1", name: "J", avatarUrl: "v1.png" } };
  const handler = createFetchHandler({ router, createContext: () => ({ db }) });
  let requests = 0;
  const client = createFixtureClient({
    router,
    transport: fetchTransport({
      url: "https://probe.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests += 1;
        return handler(new Request(input, init));
      }) as typeof globalThis.fetch,
    }),
  });
  return { client, requestCount: () => requests };
};

describe("attack-04 hydration", () => {
  test("4a: even an OBSERVED hydrated query is unbranded — replaceEqualDeep discards the re-decoded object", async () => {
    const { client } = boot();
    const server = createQueryRuntime({ client });
    const sMe = server.observe(client.me, {}, { staleTime: 60_000 });
    await waitFor(sMe, (s) => s.state === "success");
    const dehydrated = server.dehydrate();
    sMe.destroy();
    server.clear();

    const browser = createQueryRuntime({ client });
    browser.hydrate(dehydrated);
    const header = browser.observe(client.me, {}, { staleTime: 60_000 });
    const stopHeader = header.subscribe(() => undefined);
    await sleep(10);

    // Mechanism check: what object actually sits in the cache after the
    // observe-time re-decode "normalization"? If replaceEqualDeep kept the
    // hydrated (unbranded) object, collectEntities finds nothing.
    const cached = browser.cache.get(client.me, {});
    const { collectEntities } = await import("../../src/model.js");
    expect(collectEntities([cached]).length).toBe(1); // MECHANISM ASSERTION

    const mutation = browser.mutation(client.setAvatar);
    const result = await mutation.getCurrentState().mutate({ avatarUrl: "v2.png" });
    expect(result.ok).toBe(true);
    await sleep(20);

    const headerState = header.getCurrentState();
    if (headerState.state !== "success") throw new Error("unreachable");
    // ATTACK ASSERTION: the flagship patch must land post-hydration.
    expect(headerState.value.avatarUrl).toBe("v2.png");

    stopHeader();
    header.destroy();
    mutation.destroy();
    browser.clear();
  });

  test("4b: entity patch misses a hydrated-but-not-yet-observed query; later observe serves stale as fresh", async () => {
    const { client, requestCount } = boot();

    // SSR pass: both queries cached and dehydrated.
    const server = createQueryRuntime({ client });
    const sMe = server.observe(client.me, {}, { staleTime: 60_000 });
    const sProfile = server.observe(client.profile, {}, { staleTime: 60_000 });
    await waitFor(sMe, (s) => s.state === "success");
    await waitFor(sProfile, (s) => s.state === "success");
    const dehydrated = server.dehydrate();
    sMe.destroy();
    sProfile.destroy();
    server.clear();

    // Browser pass: hydrate, observe ONLY `me` (the header renders first).
    const browser = createQueryRuntime({ client });
    browser.hydrate(dehydrated);
    const header = browser.observe(client.me, {}, { staleTime: 60_000 });
    const stopHeader = header.subscribe(() => undefined);

    // A mutation fires before the profile page is visited.
    const mutation = browser.mutation(client.setAvatar);
    const result = await mutation.getCurrentState().mutate({ avatarUrl: "v2.png" });
    expect(result.ok).toBe(true);
    await sleep(20);

    // Now the profile page mounts, within staleTime.
    const before = requestCount();
    const profile = browser.observe(client.profile, {}, { staleTime: 60_000 });
    const stopProfile = profile.subscribe(() => undefined);
    await sleep(20);
    const profileState = profile.getCurrentState();
    if (profileState.state !== "success") throw new Error("unreachable");
    // ATTACK ASSERTION: the profile should show the patched avatar (or at
    // minimum have refetched). It shows the pre-mutation snapshot as fresh.
    const refetched = requestCount() > before;
    expect(profileState.value.avatarUrl === "v2.png" || refetched).toBe(true);

    stopHeader();
    stopProfile();
    header.destroy();
    profile.destroy();
    mutation.destroy();
    browser.clear();
  });
});

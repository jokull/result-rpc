/**
 * The SSR prefetch layer — the piece that differs most from the RSC
 * examples (09-waku, 10-nextjs).
 *
 * TanStack Start is SSR + file-based routing, not RSC. There is no async
 * server component to await a query in: the prefetch point is a route
 * `loader`, and loaders are ISOMORPHIC — they run on the server during the
 * document request and in the BROWSER on every client-side navigation.
 * So a loader may not import the database. The server boundary inside a
 * loader is `createServerFn`: Start compiles the handler body out of the
 * client bundle and leaves a fetch stub behind.
 *
 * Each server function builds its own per-request runtime over an
 * in-process PARITY server client (same middleware, codecs and envelope as
 * the wire), prefetches, and returns `runtime.dehydrate()` — a plain
 * `{ v, serializer, payload }` object that rides the loader's SSR payload
 * like any other loader data. The route component hands it to
 * `<ResultRpcHydrationBoundary>`.
 *
 * (RSC's `cache()` per-request memo has no analogue here, and needs none:
 * one loader = one server call = one runtime = one dehydrate.)
 */
import { createServerFn } from "@tanstack/react-start";
import { createQueryRuntime } from "result-rpc/query";
import { createServerClient } from "result-rpc/server";
import { createContext, router } from "./rpc-server.js";

const buildRuntime = () => {
  const serverClient = createServerClient(router, {
    mode: "parity",
    context: createContext(),
  });
  return { runtime: createQueryRuntime({ client: serverClient }), serverClient };
};

/** Home route loader: first feed page + the aggregate, in one payload. */
export const prefetchHome = createServerFn({ method: "GET" }).handler(async () => {
  const { runtime, serverClient } = buildRuntime();
  await Promise.all([
    runtime.prefetchPaginated(serverClient.spots.feed, {}),
    runtime.prefetch(serverClient.stats.overview, {}),
  ]);
  return runtime.dehydrate();
});

/**
 * Detail route loader, keyed by the route param. The not-found case is
 * prefetched too: the boundary hydrates the FAILURE and the client renders
 * it without a fetch.
 */
export const prefetchSpot = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { runtime, serverClient } = buildRuntime();
    await runtime.prefetch(serverClient.spots.byId, { id: data.id });
    return runtime.dehydrate();
  });

/**
 * Dynamic home page — an async server component. It builds a per-request
 * runtime over the in-process parity client, prefetches the first feed
 * page and the aggregate, and hands the dehydrated cache across the RSC
 * boundary. The client components under the boundary render "success" on
 * their first paint — no loading flash, no client round-trip.
 */
import { ResultRpcHydrationBoundary } from "result-rpc/react";
import { AddSpotForm, Feed, StatsBar } from "../components/feed.js";
import { getServerRuntime } from "../rsc.js";

export default async function HomePage() {
  const { runtime, serverClient } = getServerRuntime();
  await Promise.all([
    runtime.prefetchPaginated(serverClient.spots.feed, {}),
    runtime.prefetch(serverClient.stats.overview, {}),
  ]);

  return (
    <ResultRpcHydrationBoundary state={runtime.dehydrate()}>
      <StatsBar />
      <AddSpotForm />
      <Feed />
    </ResultRpcHydrationBoundary>
  );
}

export const getConfig = async () => {
  return { render: "dynamic" } as const;
};

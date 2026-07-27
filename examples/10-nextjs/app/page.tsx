/**
 * Home — an async SERVER component. It builds a per-request runtime over the
 * in-process parity client, prefetches the first feed page and the aggregate,
 * and hands the dehydrated cache across the RSC boundary as an ordinary prop.
 *
 * `ResultRpcHydrationBoundary` comes from `result-rpc/react`, which is marked
 * "use client" — importing it HERE is fine and intended: the bundler turns it
 * into a client reference instead of evaluating it on the server. (Contrast
 * src/rsc.ts, which must actually *call* createQueryRuntime and therefore
 * imports it from the react-free `result-rpc/query`.)
 */
import { ResultRpcHydrationBoundary } from "result-rpc/react";
import { AddSpotForm, Feed, StatsBar } from "../src/components/feed";
import { getServerRuntime } from "../src/rsc";

/** The feed reads sqlite on every request — opt out of static rendering. */
export const dynamic = "force-dynamic";

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

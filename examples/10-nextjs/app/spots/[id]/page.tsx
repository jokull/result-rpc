/**
 * Dynamic segment: /spots/spot-07. Same per-request prefetch + hydration
 * boundary as the home page, scoped to one detail query.
 *
 * Next 16 makes `params` a Promise — await it before prefetching.
 */
import { ResultRpcHydrationBoundary } from "result-rpc/react";
import { SpotDetail } from "../../../src/components/spot-detail";
import { getServerRuntime } from "../../../src/rsc";

export const dynamic = "force-dynamic";

export default async function SpotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { runtime, serverClient } = getServerRuntime();
  // The prefetch settles to a Result; a `spot/not-found` failure is fine to
  // ignore here. `dehydrate()` only carries SUCCESSFUL queries, so an unknown
  // id renders the skeleton and the client re-fetches to get the error —
  // failures are deliberately not cached across the boundary.
  await runtime.prefetch(serverClient.spots.byId, { id });

  return (
    <ResultRpcHydrationBoundary state={runtime.dehydrate()}>
      <SpotDetail id={id} />
    </ResultRpcHydrationBoundary>
  );
}

/**
 * Segment route: /spot-07 etc. Same per-request prefetch + hydration
 * boundary pattern as the home page, scoped to one detail query.
 */
import type { PageProps } from "waku/router";
import { ResultRpcHydrationBoundary } from "result-rpc/react";
import { SpotDetail } from "../components/spot-detail.js";
import { getServerRuntime } from "../rsc.js";

export default async function SpotPage({ id }: PageProps<"/[id]">) {
  const { runtime, serverClient } = getServerRuntime();
  // Prefetch even the not-found case: the boundary hydrates the failure and
  // the client renders it without a fetch.
  await runtime.prefetch(serverClient.spots.byId, { id });

  return (
    <ResultRpcHydrationBoundary state={runtime.dehydrate()}>
      <SpotDetail id={id} />
    </ResultRpcHydrationBoundary>
  );
}

export const getConfig = async () => {
  return { render: "dynamic" } as const;
};

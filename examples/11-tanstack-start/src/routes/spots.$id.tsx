/**
 * Segment route: /spots/spot-07. Same loader→boundary pattern as the home
 * route, scoped to one detail query and keyed by the route param.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ResultRpcHydrationBoundary } from "result-rpc/react";
import { SpotDetail } from "../components/spot-detail.js";
import { prefetchSpot } from "../ssr.js";

export const Route = createFileRoute("/spots/$id")({
  loader: ({ params }) => prefetchSpot({ data: { id: params.id } }),
  component: SpotPage,
});

function SpotPage() {
  const { id } = Route.useParams();
  const state = Route.useLoaderData();
  return (
    <ResultRpcHydrationBoundary state={state}>
      <SpotDetail id={id} />
    </ResultRpcHydrationBoundary>
  );
}

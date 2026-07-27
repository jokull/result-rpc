/**
 * Home route. THE integration point of this example:
 *
 *   loader  → one server function that prefetches and dehydrates
 *   component → <ResultRpcHydrationBoundary state={loader data}>
 *
 * On the document request the loader runs during SSR, so the HTML already
 * contains the rows and the dehydrated cache rides the router's SSR
 * payload. On a client-side navigation back here the same loader runs in
 * the browser and calls the server function over the wire — either way the
 * component receives the same `{ v, serializer, payload }` value.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ResultRpcHydrationBoundary } from "result-rpc/react";
import { AddSpotForm, Feed, StatsBar } from "../components/feed.js";
import { prefetchHome } from "../ssr.js";

export const Route = createFileRoute("/")({
  loader: () => prefetchHome(),
  component: Home,
});

function Home() {
  const state = Route.useLoaderData();
  return (
    <ResultRpcHydrationBoundary state={state}>
      <StatsBar />
      <AddSpotForm />
      <Feed />
    </ResultRpcHydrationBoundary>
  );
}

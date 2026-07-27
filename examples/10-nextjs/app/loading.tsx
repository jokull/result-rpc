/**
 * Route-level fallback for the home page's server work (the sqlite reads in
 * the prefetch). Next streams this while the async server component resolves,
 * so the shimmer is what a slow prefetch looks like — the client components
 * below never render their own skeletons on a prefetched paint.
 */
import { FeedSkeleton, StatsSkeleton } from "../src/components/skeleton";

export default function Loading() {
  return (
    <>
      <StatsSkeleton />
      <FeedSkeleton count={5} />
    </>
  );
}

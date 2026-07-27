/**
 * Shimmer skeletons — shared component (no hooks, no browser APIs), usable
 * from both server and client components. Visible only when a query is
 * genuinely pending, i.e. a client-side navigation the server didn't
 * prefetch; the hydrated first paint never shows these.
 */
export const SkeletonRow = () => (
  <li className="card skeleton-card" aria-hidden>
    <div className="skeleton-line w-40" />
    <div className="skeleton-line w-90" />
    <div className="skeleton-line w-70" />
  </li>
);

export const FeedSkeleton = ({ count = 5 }: { count?: number }) => (
  <ul className="feed">
    {Array.from({ length: count }, (_, i) => (
      <SkeletonRow key={i} />
    ))}
  </ul>
);

export const DetailSkeleton = () => (
  <div className="card skeleton-card" aria-hidden>
    <div className="skeleton-line w-40" style={{ height: "1.6rem" }} />
    <div className="skeleton-line w-25" />
    <div className="skeleton-line w-90" />
    <div className="skeleton-line w-80" />
  </div>
);

export const StatsSkeleton = () => (
  <div className="stats" aria-hidden>
    {Array.from({ length: 3 }, (_, i) => (
      <div className="stat skeleton-card" key={i}>
        <div className="skeleton-line w-40" />
        <div className="skeleton-line w-70" />
      </div>
    ))}
  </div>
);

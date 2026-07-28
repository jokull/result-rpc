/**
 * The paginated feed. On the first paint after SSR this renders the
 * server-prefetched rows straight from the hydrated cache — state is
 * "success" immediately, no skeleton flash, no client round-trip.
 *
 * NOTE: no `"use client"` directive. Start is SSR, not RSC — every
 * component in the tree renders on the server AND hydrates on the client,
 * so there is no directive to place. The boundary that keeps the database
 * out of this file is `createServerFn` in ssr.ts, not a directive here.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useResultMutation, useResultPaginatedQuery, useResultQuery } from "result-rpc/react";
import { client } from "../rpc-client.js";
import type { SpotRow } from "../models.js";
import { FeedSkeleton, StatsSkeleton } from "./skeleton.js";

const LikeButton = ({ spot }: { spot: SpotRow }) => {
  // The mutation output is the Spot ENTITY: the cache patches this row (and
  // the detail page, if cached) in place. No refetch, no page splicing.
  const like = useResultMutation(client.spots.like);
  return (
    <button
      className="like"
      disabled={like.state === "pending"}
      onClick={() => like.mutate({ id: spot.id })}
    >
      ♥ {spot.likes}
    </button>
  );
};

const SpotCard = ({ spot }: { spot: SpotRow }) => (
  <li className="card">
    <div className="card-head">
      <Link to="/spots/$id" params={{ id: spot.id }} className="card-title">
        {spot.name}
      </Link>
      <LikeButton spot={spot} />
    </div>
    <span className="badge">{spot.city}</span>
    <p className="card-body">{spot.description}</p>
  </li>
);

export const Feed = () => {
  // staleTime trusts the loader's prefetch for a minute: first mount makes
  // ZERO client requests — the whole point of prefetching.
  const feed = useResultPaginatedQuery(client.spots.feed, {}, { staleTime: 60_000 });

  if (feed.state === "pending") return <FeedSkeleton count={5} />;
  if (feed.state === "failure") {
    return <p className="error">Feed failed: {feed.error._tag}</p>;
  }

  return (
    <>
      <ul className="feed" data-testid="feed">
        {feed.rows.map((spot) => (
          <SpotCard key={spot.id} spot={spot} />
        ))}
      </ul>
      {feed.hasNext && (
        <button className="load-more" onClick={feed.fetchNext} disabled={feed.fetchingNext}>
          {feed.fetchingNext ? "Loading…" : "Load more"}
        </button>
      )}
      <p className="meta">
        {feed.rows.length} spots loaded · {feed.pageCount} page
        {feed.pageCount === 1 ? "" : "s"}
      </p>
    </>
  );
};

export const StatsBar = () => {
  // The one-off aggregate: no entity identity, kept fresh via `.affects()`
  // on the like/add mutations — liking a spot bumps "total likes" here too.
  const stats = useResultQuery(client.stats.overview, {}, { staleTime: 60_000 });
  if (stats.state === "pending") return <StatsSkeleton />;
  if (stats.state === "failure") return null;
  return (
    <div className="stats">
      <div className="stat">
        <strong>{stats.value.spotCount}</strong>
        <span>spots</span>
      </div>
      <div className="stat">
        <strong data-testid="total-likes">{stats.value.totalLikes}</strong>
        <span>total likes</span>
      </div>
      <div className="stat">
        <strong>{stats.value.topCity.city}</strong>
        <span>top city ({stats.value.topCity.count})</span>
      </div>
    </div>
  );
};

export const AddSpotForm = () => {
  const [name, setName] = useState("");
  const [city, setCity] = useState("Kyoto");
  const add = useResultMutation(client.spots.add, {
    onSuccess: () => setName(""),
  });
  return (
    <form
      className="add-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        add.mutate({
          name: name.trim(),
          city,
          description: `Suggested from the browser: ${name.trim()}.`,
        });
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Suggest a spot (unique name)"
        aria-label="Spot name"
      />
      <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
        {["Kyoto", "Tokyo", "Osaka", "Nara", "Kanazawa", "Hakone"].map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <button type="submit" disabled={add.state === "pending"}>
        Add
      </button>
      {add.state === "failure" && (
        <span className="error" data-testid="add-error">
          {add.error._tag === "spot/name-taken"
            ? `"${add.error.data.name}" already exists`
            : `Failed: ${add.error._tag}`}
        </span>
      )}
    </form>
  );
};

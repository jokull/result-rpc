/**
 * Detail view for one spot. The /spots/$id loader prefetched this exact
 * query on the server, so the first paint is "success". If the same spot
 * was liked from the feed earlier in the session, this view already shows
 * the bumped count — entity patching crossed the query boundary before
 * this component ever fetched.
 */
import { Link } from "@tanstack/react-router";
import { useResultMutation, useResultQuery } from "result-rpc/react";
import { client } from "../rpc-client.js";
import { DetailSkeleton } from "./skeleton.js";

export const SpotDetail = ({ id }: { id: string }) => {
  const spot = useResultQuery(client.spots.byId, { id }, { staleTime: 60_000 });
  const like = useResultMutation(client.spots.like);

  if (spot.state === "pending") return <DetailSkeleton />;
  if (spot.state === "failure") {
    return (
      <div className="card">
        <p className="error">
          {spot.error._tag === "spot/not-found"
            ? `No spot with id "${id}".`
            : `Failed: ${spot.error._tag}`}
        </p>
        <Link to="/">← Back to the feed</Link>
      </div>
    );
  }

  return (
    <div className="card detail" data-testid="detail">
      <div className="card-head">
        <h1>{spot.value.name}</h1>
        <button
          className="like"
          disabled={like.state === "pending"}
          onClick={() => like.mutate({ id: spot.value.id })}
        >
          ♥ {spot.value.likes}
        </button>
      </div>
      <span className="badge">{spot.value.city}</span>
      <p className="card-body">{spot.value.description}</p>
      <Link to="/">← Back to the feed</Link>
    </div>
  );
};

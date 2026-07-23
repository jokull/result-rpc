/**
 * Rung 3, shared domain: errors, codecs, and the layer declarations.
 *
 * This file is safe on both sides of the wire. It declares the session layer
 * (optional — a cookie may or may not resolve) and the viewer layer (required —
 * refines `User | null` to `User`, owns the auth union).
 */
import { defineLayer, err, error, ok, wire, type InputOf } from "../../src/index.js";

// -- errors ---------------------------------------------------------------------

export const Unauthorized = error({ tag: "auth/unauthorized", httpStatus: "unauthorized" });
export const SessionExpired = error({ tag: "auth/session-expired", httpStatus: "unauthorized" });

export const TripNotFound = error({
  tag: "trip/not-found",
  data: wire.object({ tripId: wire.string }),
  httpStatus: "not-found",
});

export const TripLocked = error({
  tag: "trip/locked",
  data: wire.object({ lockedBy: wire.string }),
  httpStatus: "conflict",
});

export const authErrors = { Unauthorized, SessionExpired };

// -- codecs ---------------------------------------------------------------------

export const UserCodec = wire.object({ id: wire.string, name: wire.string });
export type User = InputOf<typeof UserCodec>;

export const TripCodec = wire.object({
  id: wire.string,
  title: wire.string,
  ownerId: wire.string,
  startsAt: wire.date,
});
export type Trip = InputOf<typeof TripCodec>;

export const TripEventCodec = wire.object({
  tripId: wire.string,
  kind: wire.union([wire.literal("renamed"), wire.literal("locked")] as const),
  at: wire.date,
});
export type TripEvent = InputOf<typeof TripEventCodec>;

// -- layers -----------------------------------------------------------------------

/** Optional: every request has a session slot; it may hold nobody. */
export const SessionLayer = defineLayer({
  name: "session",
  key: "viewer",
  provides: wire.union([UserCodec, wire.null] as const),
  errors: {},
});

/** Required: narrows `viewer` to a real user and owns the auth union. */
export const ViewerLayer = SessionLayer.require({
  name: "viewer",
  provides: UserCodec,
  errors: authErrors,
  refine: ({ value, errors }) =>
    value === null ? err(errors.Unauthorized()) : ok(value),
});

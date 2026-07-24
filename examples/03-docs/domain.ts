/**
 * Rung 3, shared domain: errors, codecs, and the layer declarations.
 *
 * This file is safe on both sides of the wire. It declares the session layer
 * (optional — a cookie may or may not resolve) and the viewer layer (required —
 * refines `User | null` to `User`, owns the auth union).
 */
import { defineLayer, defineModel, err, error, ok, wire, type InputOf } from "../../src/index.js";

// -- errors ---------------------------------------------------------------------

export const Unauthorized = error({ tag: "auth/unauthorized", httpStatus: "unauthorized" });
export const SessionExpired = error({ tag: "auth/session-expired", httpStatus: "unauthorized" });

export const DocNotFound = error({
  tag: "doc/not-found",
  data: wire.object({ docId: wire.string }),
  httpStatus: "not-found",
});

export const DocLocked = error({
  tag: "doc/locked",
  data: wire.object({ lockedBy: wire.string }),
  httpStatus: "conflict",
});

/**
 * 403, not 401. `Unauthorized` belongs to the viewer layer and is claimed by
 * its shell (whose reaction is a sign-in redirect) — using it for an ownership
 * check would sign the user out. Forbidden is a domain outcome the component
 * renders.
 */
export const DocForbidden = error({ tag: "doc/forbidden", httpStatus: "forbidden" });

export const authErrors = { Unauthorized, SessionExpired };

// -- codecs ---------------------------------------------------------------------

/** Models: identity for the cache graph. The codecs are ordinary wire codecs. */
export const UserModel = defineModel("user", {
  key: "id",
  shape: { id: wire.string, name: wire.string, avatarUrl: wire.string },
});
export const UserCodec = UserModel.codec;
export type User = InputOf<typeof UserCodec>;

export const DocModel = defineModel("doc", {
  key: "id",
  shape: {
    id: wire.string,
    title: wire.string,
    ownerId: wire.string,
    savedAt: wire.date,
  },
});
export const DocCodec = DocModel.codec;
export type Doc = InputOf<typeof DocCodec>;

export const DocEventCodec = wire.object({
  docId: wire.string,
  kind: wire.union([wire.literal("renamed"), wire.literal("locked")] as const),
  at: wire.date,
});
export type DocEvent = InputOf<typeof DocEventCodec>;

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

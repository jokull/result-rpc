import { frameworkError as error } from "./error.js";
import { wire } from "./wire.js";

export const ServerBadRequest = error({
  tag: "server/bad-request",
  data: wire.object({
    issues: wire.array(wire.object({
      path: wire.array(wire.string),
      message: wire.string,
    })),
  }),
  httpStatus: 400,
  retry: "never",
  visibility: "public",
  severity: "warning",
});

export const ServerInternal = error({
  tag: "server/internal",
  data: wire.object({ incidentId: wire.string }),
  httpStatus: 500,
  retry: "never",
  visibility: "public",
  severity: "error",
});

export const ClientOffline = error({
  tag: "client/offline",
  data: wire.object({}),
  httpStatus: 503,
  retry: "transient",
  visibility: "public",
  severity: "info",
});

export const ClientNetworkFailure = error({
  tag: "client/network-failure",
  data: wire.object({ retryable: wire.boolean }),
  httpStatus: 503,
  retry: "transient",
  visibility: "public",
  severity: "warning",
});

export const ClientTimeout = error({
  tag: "client/timeout",
  data: wire.object({ timeoutMs: wire.integer({ min: 0 }) }),
  httpStatus: 504,
  retry: "transient",
  visibility: "public",
  severity: "warning",
});

export const ClientHttpFailure = error({
  tag: "client/http-failure",
  data: wire.object({ status: wire.integer({ min: 100, max: 599 }) }),
  httpStatus: 502,
  retry: "transient",
  visibility: "public",
  severity: "warning",
});

export const ClientProtocolViolation = error({
  tag: "client/protocol-violation",
  data: wire.object({
    reason: wire.union([
      wire.literal("content-type"),
      wire.literal("version"),
      wire.literal("envelope"),
      wire.literal("unknown-tag"),
    ] as const),
  }),
  httpStatus: 502,
  retry: "never",
  visibility: "public",
  severity: "error",
});

export const ClientDecodeFailure = error({
  tag: "client/decode-failure",
  data: wire.object({
    target: wire.union([wire.literal("success"), wire.literal("error")] as const),
  }),
  httpStatus: 502,
  retry: "never",
  visibility: "public",
  severity: "error",
});

/**
 * A contract failure reclassified because the server's contract digest did not
 * match this client's: the client is a stale deploy, not a buggy one. The fix
 * is a reload, so the built-in stale shell defaults to exactly that. Carries
 * only the original tag — never values.
 */
export const ClientStale = error({
  tag: "client/stale",
  data: wire.object({ reclassifiedFrom: wire.string }),
  httpStatus: 426,
  retry: "never",
  visibility: "public",
  severity: "info",
});

/** The tags a contract-digest mismatch may reclassify into `client/stale`. */
export const STALE_RECLASSIFIABLE_TAGS: ReadonlySet<string> = new Set([
  "server/bad-request",
  "client/decode-failure",
  "client/protocol-violation",
  "client/http-failure",
]);

/**
 * Transport failures: real, recoverable, and not about any single operation.
 * Every member declares `retry: "transient"`. Shell layers usually claim these
 * with `effect: "pause"` so the app shell owns the banner.
 */
export const transportErrors = {
  ClientOffline,
  ClientNetworkFailure,
  ClientTimeout,
} as const;

/**
 * Defects: nothing a component can render a branch for. Shell layers usually
 * claim these with `effect: "escalate"` so the nearest error boundary owns them.
 */
export const defectErrors = {
  ClientHttpFailure,
  ClientProtocolViolation,
  ClientDecodeFailure,
  ServerBadRequest,
  ServerInternal,
} as const;

/** A deploy left this client behind; the built-in stale shell reloads by default. */
export const staleErrors = {
  ClientStale,
} as const;

export const frameworkErrorDefinitions = {
  ServerBadRequest,
  ServerInternal,
  ClientOffline,
  ClientNetworkFailure,
  ClientTimeout,
  ClientHttpFailure,
  ClientProtocolViolation,
  ClientDecodeFailure,
  ClientStale,
} as const;

// Each framework error exports its value and its error type under one name.
export type ServerBadRequest = ReturnType<typeof ServerBadRequest>;
export type ServerInternal = ReturnType<typeof ServerInternal>;
export type ClientOffline = ReturnType<typeof ClientOffline>;
export type ClientNetworkFailure = ReturnType<typeof ClientNetworkFailure>;
export type ClientTimeout = ReturnType<typeof ClientTimeout>;
export type ClientHttpFailure = ReturnType<typeof ClientHttpFailure>;
export type ClientProtocolViolation = ReturnType<typeof ClientProtocolViolation>;
export type ClientDecodeFailure = ReturnType<typeof ClientDecodeFailure>;
export type ClientStale = ReturnType<typeof ClientStale>;

export type ClientBoundaryError =
  | ClientOffline
  | ClientNetworkFailure
  | ClientTimeout
  | ClientHttpFailure
  | ClientProtocolViolation
  | ClientDecodeFailure
  | ClientStale;

/** Maps codec issues into `server/bad-request` data: paths and messages only, never values. */
export const badRequestFromIssues = (cause: unknown): ServerBadRequest => {
  const issues = Array.isArray(cause)
    ? (cause as readonly { readonly path?: readonly (string | number)[]; readonly message?: unknown }[])
        .slice(0, 20)
        .map((issue) => ({
          path: (issue.path ?? []).map(String),
          message: typeof issue.message === "string" ? issue.message : "Invalid value",
        }))
    : [{ path: [], message: "Invalid input" }];
  return ServerBadRequest({ issues });
};

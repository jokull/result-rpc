import { frameworkError as error } from "./error.js";
import { wire } from "./wire.js";

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

export const frameworkErrorDefinitions = {
  ServerInternal,
  ClientOffline,
  ClientNetworkFailure,
  ClientTimeout,
  ClientHttpFailure,
  ClientProtocolViolation,
  ClientDecodeFailure,
} as const;

export type ServerInternal = ReturnType<typeof ServerInternal>;
export type Offline = ReturnType<typeof ClientOffline>;
export type NetworkFailure = ReturnType<typeof ClientNetworkFailure>;
export type Timeout = ReturnType<typeof ClientTimeout>;
export type HttpFailure = ReturnType<typeof ClientHttpFailure>;
export type ProtocolViolation = ReturnType<typeof ClientProtocolViolation>;
export type DecodeFailure = ReturnType<typeof ClientDecodeFailure>;

export type ClientBoundaryError =
  | Offline
  | NetworkFailure
  | Timeout
  | HttpFailure
  | ProtocolViolation
  | DecodeFailure;

export declare const ServerBadRequest: import("./error.js").ErrorDefinition<"server/bad-request", {
    readonly issues: readonly ({
        readonly message: string;
        readonly path: readonly string[];
    } & {})[];
} & {}, {
    readonly issues: readonly ({
        readonly message: string;
        readonly path: readonly string[];
    } & {})[];
} & {}, "public">;
export declare const ServerInternal: import("./error.js").ErrorDefinition<"server/internal", {
    readonly incidentId: string;
} & {}, {
    readonly incidentId: string;
} & {}, "public">;
export declare const ClientOffline: import("./error.js").ErrorDefinition<"client/offline", Readonly<Record<string, never>>, Readonly<Record<string, never>>, "public">;
export declare const ClientNetworkFailure: import("./error.js").ErrorDefinition<"client/network-failure", {
    readonly retryable: boolean;
} & {}, {
    readonly retryable: boolean;
} & {}, "public">;
export declare const ClientTimeout: import("./error.js").ErrorDefinition<"client/timeout", {
    readonly timeoutMs: number;
} & {}, {
    readonly timeoutMs: number;
} & {}, "public">;
export declare const ClientHttpFailure: import("./error.js").ErrorDefinition<"client/http-failure", {
    readonly status: number;
} & {}, {
    readonly status: number;
} & {}, "public">;
export declare const ClientProtocolViolation: import("./error.js").ErrorDefinition<"client/protocol-violation", {
    readonly reason: "content-type" | "envelope" | "unknown-tag" | "version";
} & {}, {
    readonly reason: "content-type" | "envelope" | "unknown-tag" | "version";
} & {}, "public">;
export declare const ClientDecodeFailure: import("./error.js").ErrorDefinition<"client/decode-failure", {
    readonly target: "error" | "success";
} & {}, {
    readonly target: "error" | "success";
} & {}, "public">;
/**
 * A contract failure reclassified because the server's contract digest did not
 * match this client's: the client is a stale deploy, not a buggy one. The fix
 * is a reload, so the built-in stale shell defaults to exactly that. Carries
 * only the original tag — never values.
 */
export declare const ClientStale: import("./error.js").ErrorDefinition<"client/stale", {
    readonly reclassifiedFrom: string;
} & {}, {
    readonly reclassifiedFrom: string;
} & {}, "public">;
/** The tags a contract-digest mismatch may reclassify into `client/stale`. */
export declare const STALE_RECLASSIFIABLE_TAGS: ReadonlySet<string>;
/**
 * Transport failures: real, recoverable, and not about any single operation.
 * Every member declares `retry: "transient"`. Shell layers usually claim these
 * with `effect: "pause"` so the app shell owns the banner.
 */
export declare const transportErrors: {
    readonly ClientOffline: import("./error.js").ErrorDefinition<"client/offline", Readonly<Record<string, never>>, Readonly<Record<string, never>>, "public">;
    readonly ClientNetworkFailure: import("./error.js").ErrorDefinition<"client/network-failure", {
        readonly retryable: boolean;
    } & {}, {
        readonly retryable: boolean;
    } & {}, "public">;
    readonly ClientTimeout: import("./error.js").ErrorDefinition<"client/timeout", {
        readonly timeoutMs: number;
    } & {}, {
        readonly timeoutMs: number;
    } & {}, "public">;
};
/**
 * Defects: nothing a component can render a branch for. Shell layers usually
 * claim these with `effect: "escalate"` so the nearest error boundary owns them.
 */
export declare const defectErrors: {
    readonly ClientHttpFailure: import("./error.js").ErrorDefinition<"client/http-failure", {
        readonly status: number;
    } & {}, {
        readonly status: number;
    } & {}, "public">;
    readonly ClientProtocolViolation: import("./error.js").ErrorDefinition<"client/protocol-violation", {
        readonly reason: "content-type" | "envelope" | "unknown-tag" | "version";
    } & {}, {
        readonly reason: "content-type" | "envelope" | "unknown-tag" | "version";
    } & {}, "public">;
    readonly ClientDecodeFailure: import("./error.js").ErrorDefinition<"client/decode-failure", {
        readonly target: "error" | "success";
    } & {}, {
        readonly target: "error" | "success";
    } & {}, "public">;
    readonly ServerBadRequest: import("./error.js").ErrorDefinition<"server/bad-request", {
        readonly issues: readonly ({
            readonly message: string;
            readonly path: readonly string[];
        } & {})[];
    } & {}, {
        readonly issues: readonly ({
            readonly message: string;
            readonly path: readonly string[];
        } & {})[];
    } & {}, "public">;
    readonly ServerInternal: import("./error.js").ErrorDefinition<"server/internal", {
        readonly incidentId: string;
    } & {}, {
        readonly incidentId: string;
    } & {}, "public">;
};
/** A deploy left this client behind; the built-in stale shell reloads by default. */
export declare const staleErrors: {
    readonly ClientStale: import("./error.js").ErrorDefinition<"client/stale", {
        readonly reclassifiedFrom: string;
    } & {}, {
        readonly reclassifiedFrom: string;
    } & {}, "public">;
};
export declare const frameworkErrorDefinitions: {
    readonly ServerBadRequest: import("./error.js").ErrorDefinition<"server/bad-request", {
        readonly issues: readonly ({
            readonly message: string;
            readonly path: readonly string[];
        } & {})[];
    } & {}, {
        readonly issues: readonly ({
            readonly message: string;
            readonly path: readonly string[];
        } & {})[];
    } & {}, "public">;
    readonly ServerInternal: import("./error.js").ErrorDefinition<"server/internal", {
        readonly incidentId: string;
    } & {}, {
        readonly incidentId: string;
    } & {}, "public">;
    readonly ClientOffline: import("./error.js").ErrorDefinition<"client/offline", Readonly<Record<string, never>>, Readonly<Record<string, never>>, "public">;
    readonly ClientNetworkFailure: import("./error.js").ErrorDefinition<"client/network-failure", {
        readonly retryable: boolean;
    } & {}, {
        readonly retryable: boolean;
    } & {}, "public">;
    readonly ClientTimeout: import("./error.js").ErrorDefinition<"client/timeout", {
        readonly timeoutMs: number;
    } & {}, {
        readonly timeoutMs: number;
    } & {}, "public">;
    readonly ClientHttpFailure: import("./error.js").ErrorDefinition<"client/http-failure", {
        readonly status: number;
    } & {}, {
        readonly status: number;
    } & {}, "public">;
    readonly ClientProtocolViolation: import("./error.js").ErrorDefinition<"client/protocol-violation", {
        readonly reason: "content-type" | "envelope" | "unknown-tag" | "version";
    } & {}, {
        readonly reason: "content-type" | "envelope" | "unknown-tag" | "version";
    } & {}, "public">;
    readonly ClientDecodeFailure: import("./error.js").ErrorDefinition<"client/decode-failure", {
        readonly target: "error" | "success";
    } & {}, {
        readonly target: "error" | "success";
    } & {}, "public">;
    readonly ClientStale: import("./error.js").ErrorDefinition<"client/stale", {
        readonly reclassifiedFrom: string;
    } & {}, {
        readonly reclassifiedFrom: string;
    } & {}, "public">;
};
export type ServerBadRequest = ReturnType<typeof ServerBadRequest>;
export type ServerInternal = ReturnType<typeof ServerInternal>;
export type ClientOffline = ReturnType<typeof ClientOffline>;
export type ClientNetworkFailure = ReturnType<typeof ClientNetworkFailure>;
export type ClientTimeout = ReturnType<typeof ClientTimeout>;
export type ClientHttpFailure = ReturnType<typeof ClientHttpFailure>;
export type ClientProtocolViolation = ReturnType<typeof ClientProtocolViolation>;
export type ClientDecodeFailure = ReturnType<typeof ClientDecodeFailure>;
export type ClientStale = ReturnType<typeof ClientStale>;
export type ClientBoundaryError = ClientOffline | ClientNetworkFailure | ClientTimeout | ClientHttpFailure | ClientProtocolViolation | ClientDecodeFailure | ClientStale;
/** Maps codec issues into `server/bad-request` data: paths and messages only, never values. */
export declare const badRequestFromIssues: (cause: unknown) => ServerBadRequest;

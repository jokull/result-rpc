import type { AnyErrorDefinition, AnyTaggedError } from "../error.js";
import type { QueryState } from "../query/runtime.js";
export interface ClaimRegistry<TError extends AnyTaggedError = AnyTaggedError> {
    readonly definitions: ReadonlyMap<string, AnyErrorDefinition>;
    is(value: unknown): value is TError;
}
export interface ClaimEntry {
    readonly name: string;
    readonly effect: "pause" | "escalate";
    readonly registry: ClaimRegistry;
    readonly acquire: (operationId: string, leaseId: ClaimLease, error: AnyTaggedError, retry?: () => void | Promise<void>) => ClaimAcquisition;
    readonly release: (operationId: string, leaseId: ClaimLease) => void;
}
/** Opaque lifecycle identity for one committed claim owner. */
export type ClaimLease = object;
/** A committed Suspense boundary owns claims for children that cannot commit. */
export interface SuspenseClaimLease {
    readonly token: ClaimLease;
    readonly activate: () => void;
    readonly isActive: () => boolean;
    readonly retain: (entry: ClaimEntry, operationId: string) => void;
    readonly forget: (entry: ClaimEntry, operationId: string) => void;
    readonly release: () => void;
}
export declare const createSuspenseClaimLease: () => SuspenseClaimLease;
export declare const SuspenseClaimLeaseContext: import("react").Context<SuspenseClaimLease | null>;
export declare const useSuspenseClaimLease: () => SuspenseClaimLease | null;
export interface ClaimAcquisition {
    /** Whether this exact operation/error pair was newly acquired. */
    readonly fresh: boolean;
    /** Resolves after this operation is released or its shell resumes it. */
    readonly resumed: Promise<void>;
}
/** Mounted claim scopes, outermost first. Providers append themselves. */
export declare const ClaimScopeContext: import("react").Context<readonly ClaimEntry[]>;
export interface AmbientClaim {
    readonly entry: ClaimEntry;
    /** Acquire outside render and wait for this exact operation to resume. */
    readonly wait: () => Promise<void>;
}
export interface ClaimObserver {
    /** Pure owner lookup used to project or escalate during render. */
    readonly render: (error: AnyTaggedError | undefined) => AmbientClaim | undefined;
    /** Reconciles a state emitted by an external observer before React is notified. */
    readonly notify: (error: AnyTaggedError | undefined) => void;
    /** Releases this operation from every owner in its current scope. */
    readonly release: () => void;
}
/**
 * One stable operation bridge shared by ordinary and Suspense hooks.
 *
 * `render` is deliberately pure. Ordinary acquisitions happen from a
 * committed effect or external observer notification. A relevant Suspense
 * retry acquires only when its thrown `wait()` promise runs, under the
 * committed boundary lease supplied by `ResultSuspense`. Request settlement
 * itself only populates cache state and can never acquire ownership.
 */
export declare const useClaimObserver: (onClaimed?: (entry: ClaimEntry, error: AnyTaggedError) => void, retry?: () => void | Promise<void>, operationId?: string, suspenseLease?: SuspenseClaimLease | null) => ClaimObserver;
/**
 * Consults the mounted claim scope for a failure. Escalating owners throw the
 * reified tagged error instance (after hooks, so hook order is stable); pausing
 * owners hold the error — reported for aggregate views — and the caller
 * projects a non-terminal state.
 */
export declare const useAmbientClaim: (observer: ClaimObserver, error: AnyTaggedError | undefined) => AmbientClaim | undefined;
/** Reads the mounted scope for imperative checks (mutation promises). */
export declare const useClaimScope: () => readonly ClaimEntry[];
export type ClaimOwnerResolution = {
    readonly state: "unclaimed";
} | {
    readonly state: "owned";
    readonly owner: ClaimEntry;
} | {
    readonly state: "incompatible";
    readonly error: TypeError;
};
/** Total exact-definition lookup for use inside external callback machinery. */
export declare const resolveClaimOwner: (entries: readonly ClaimEntry[], error: AnyTaggedError) => ClaimOwnerResolution;
/** Innermost mounted exact owner, throwing a fail-loud identity diagnostic. */
export declare const claimOwner: (entries: readonly ClaimEntry[], error: AnyTaggedError) => ClaimEntry | undefined;
/**
 * The non-terminal projection of a claimed query failure: stale success keeps
 * rendering; otherwise the operation returns to pending with fetch paused.
 */
export declare const pauseQueryProjection: <T, E extends AnyTaggedError>(state: QueryState<T, E>) => QueryState<T, never>;

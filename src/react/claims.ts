/**
 * Ambient failure claiming.
 *
 * A mounted shell is a monitor on ALL procedure activity beneath it — not just
 * operations issued through its own hooks. A tag finds a candidate owner; that
 * owner's definition registry must then recognize the exact reified instance.
 * A shell needs no knowledge of which procedures run underneath, only of the
 * definitions it owns.
 *
 * Runtime and types split deliberately:
 * - runtime absorption is ambient — every base hook consults the mounted claim
 *   scope, so a claimed definition NEVER becomes a terminal failure below its owner;
 * - type subtraction stays explicit — it rides the shell's hooks, because the
 *   type system cannot see tree position. A plain hook's union is therefore a
 *   sound over-approximation: it may list tags that can no longer surface.
 */
import { createContext, useContext, useEffect, useId, useMemo, useRef } from "react";
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
  readonly acquire: (
    id: string,
    error: AnyTaggedError,
    retry?: () => void | Promise<void>,
  ) => ClaimAcquisition;
  readonly release: (id: string) => void;
}

export interface ClaimAcquisition {
  /** Whether this exact operation/error pair was newly acquired. */
  readonly fresh: boolean;
  /** Resolves after this operation is released or its shell resumes it. */
  readonly resumed: Promise<void>;
}

/** Mounted claim scopes, outermost first. Providers append themselves. */
export const ClaimScopeContext = createContext<readonly ClaimEntry[]>([]);

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
  /** Reconciles an asynchronously settled Suspense request and waits if claimed. */
  readonly settle: (error: AnyTaggedError | undefined) => Promise<void>;
  /** Releases this operation from every owner in its current scope. */
  readonly release: () => void;
}

const ownerOf = (
  entries: readonly ClaimEntry[],
  error: AnyTaggedError | undefined,
): ClaimEntry | undefined => {
  if (!error) return undefined;
  return claimOwner(entries, error);
};

/**
 * One stable operation bridge shared by ordinary and Suspense hooks.
 *
 * `render` is deliberately pure. Acquisitions happen only from a committed
 * effect, an external observer notification, or a settled request promise.
 * That lets a first-render Suspense request reach its shell without requiring
 * the querying component to commit and without changing external state while
 * React renders.
 */
export const useClaimObserver = (
  onClaimed?: (entry: ClaimEntry, error: AnyTaggedError) => void,
  retry?: () => void | Promise<void>,
  operationId?: string,
): ClaimObserver => {
  const entries = useContext(ClaimScopeContext);
  const reactId = useId();
  const id = operationId ?? reactId;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const onClaimedRef = useRef(onClaimed);
  onClaimedRef.current = onClaimed;
  const retryRef = useRef(retry);
  retryRef.current = retry;

  const observer = useMemo<ClaimObserver>(() => {
    let current: ClaimEntry | undefined;
    let currentError: AnyTaggedError | undefined;

    const release = () => {
      current?.release(id);
      current = undefined;
      currentError = undefined;
      // A previous initial-Suspense attempt can have the same React operation
      // id but a discarded local bridge. Releasing across the mounted scope is
      // therefore intentional and idempotent.
      for (const entry of entriesRef.current) entry.release(id);
    };

    const acquire = (error: AnyTaggedError | undefined): ClaimAcquisition | undefined => {
      const owner = ownerOf(entriesRef.current, error);
      if (!owner || !error || owner.effect === "escalate") {
        release();
        return undefined;
      }
      if (current && (current !== owner || currentError !== error)) current.release(id);
      current = owner;
      currentError = error;
      const acquired = owner.acquire(id, error, () => retryRef.current?.());
      if (acquired.fresh) onClaimedRef.current?.(owner, error);
      return acquired;
    };

    return {
      render: (error) => {
        const owner = ownerOf(entriesRef.current, error);
        if (!owner || !error) return undefined;
        if (owner.effect === "escalate") throw error;
        return {
          entry: owner,
          wait: () => Promise.resolve().then(() => acquire(error)?.resumed),
        };
      },
      notify: (error) => {
        acquire(error);
      },
      settle: async (error) => {
        const acquired = acquire(error);
        if (acquired) await acquired.resumed;
      },
      release,
    };
  }, [id]);

  useEffect(() => () => observer.release(), [observer]);
  return observer;
};

/**
 * Consults the mounted claim scope for a failure. Escalating owners throw the
 * reified tagged error instance (after hooks, so hook order is stable); pausing
 * owners hold the error — reported for aggregate views — and the caller
 * projects a non-terminal state.
 */
export const useAmbientClaim = (
  observer: ClaimObserver,
  error: AnyTaggedError | undefined,
): AmbientClaim | undefined => {
  useEffect(() => {
    observer.notify(error);
  }, [observer, error]);
  return observer.render(error);
};

/** Reads the mounted scope for imperative checks (mutation promises). */
export const useClaimScope = (): readonly ClaimEntry[] => useContext(ClaimScopeContext);

/** Innermost mounted owner of a tag, if any (scope is outermost-first). */
export const claimOwner = (
  entries: readonly ClaimEntry[],
  error: AnyTaggedError,
): ClaimEntry | undefined => {
  const tag = error._tag;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const definition = entry.registry.definitions.get(tag);
    if (!definition) continue;
    if (!entry.registry.is(error)) {
      throw new TypeError(`Shell ${entry.name} claims ${tag} with a different error definition`);
    }
    return entry;
  }
  return undefined;
};

/**
 * The non-terminal projection of a claimed query failure: stale success keeps
 * rendering; otherwise the operation returns to pending with fetch paused.
 */
export const pauseQueryProjection = <T, E extends AnyTaggedError>(
  state: QueryState<T, E>,
): QueryState<T, never> => {
  const controls = {
    fetch: "paused" as const,
    failureCount: state.failureCount,
    isStale: state.isStale,
    updatedAt: state.updatedAt,
    refetch: state.refetch,
  };
  const previous = state.state === "failure" ? state.previous : undefined;
  return previous === undefined
    ? { ...controls, state: "pending" }
    : { ...controls, state: "success", value: previous };
};

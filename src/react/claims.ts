/**
 * Ambient failure claiming.
 *
 * A mounted shell is a monitor on ALL procedure activity beneath it — not just
 * operations issued through its own hooks. The wire contract makes this sound:
 * claiming is keyed by tag, so a shell needs no knowledge of which procedures
 * run underneath, only of the error union it owns.
 *
 * Runtime and types split deliberately:
 * - runtime absorption is ambient — every base hook consults the mounted claim
 *   scope, so a claimed tag NEVER becomes a terminal failure below its owner;
 * - type subtraction stays explicit — it rides the shell's hooks, because the
 *   type system cannot see tree position. A plain hook's union is therefore a
 *   sound over-approximation: it may list tags that can no longer surface.
 */
import { createContext, useContext, useEffect, useId } from "react";
import type { AnyTaggedError } from "../error.js";
import { ok } from "../result.js";
import type { QueryState } from "../query/runtime.js";

export interface ClaimEntry {
  readonly name: string;
  readonly effect: "pause" | "escalate";
  readonly tags: ReadonlySet<string>;
  readonly report: (id: string, error: AnyTaggedError) => void;
  readonly release: (id: string) => void;
  readonly whenChanged: () => Promise<void>;
}

/** Mounted claim scopes, outermost first. Providers append themselves. */
export const ClaimScopeContext = createContext<readonly ClaimEntry[]>([]);

export interface AmbientClaim {
  readonly entry: ClaimEntry;
}

/**
 * Consults the mounted claim scope for a failure. Escalating owners throw the
 * structural tagged value (after hooks, so hook order is stable); pausing
 * owners hold the error — reported for aggregate views — and the caller
 * projects a non-terminal state.
 */
export const useAmbientClaim = (
  error: AnyTaggedError | undefined,
): AmbientClaim | undefined => {
  const entries = useContext(ClaimScopeContext);
  const id = useId();
  let claimant: ClaimEntry | undefined;
  if (error) {
    // innermost owner wins
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]!;
      if (entry.tags.has(error._tag)) {
        claimant = entry;
        break;
      }
    }
  }
  const held = claimant?.effect === "pause" && error ? error : undefined;
  const holder = held ? claimant : undefined;
  useEffect(() => {
    if (!holder || !held) return;
    holder.report(id, held);
    return () => holder.release(id);
  }, [holder, held, id]);
  if (claimant?.effect === "escalate") throw error;
  return holder ? { entry: holder } : undefined;
};

/** Reads the mounted scope for imperative checks (mutation promises). */
export const useClaimScope = (): readonly ClaimEntry[] => useContext(ClaimScopeContext);

export const scopeClaims = (entries: readonly ClaimEntry[], tag: string): boolean =>
  entries.some((entry) => entry.tags.has(tag));

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
    refetch: state.refetch as unknown as () => Promise<QueryState<T, never>>,
  };
  const previous = state.state === "failure" ? state.previous : undefined;
  return previous === undefined
    ? { ...controls, state: "pending", result: undefined }
    : { ...controls, state: "success", result: ok(previous) };
};

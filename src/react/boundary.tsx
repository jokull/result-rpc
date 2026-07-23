import { createElement, type ReactNode } from "react";
import {
  defectErrors,
  staleErrors,
  transportErrors,
  type ClientStale,
} from "../framework-errors.js";
import type { ErrorUnion } from "../server/contract.js";
import { defineShell, type Shell, type TagsOf } from "./shell.js";

/**
 * The built-in owners for every failure the framework itself contributes.
 * Three concerns, three reactions:
 *
 *   TransportShell  the world flaked        → pause, resume when it returns
 *   DefectShell     the contract broke      → escalate to the error boundary
 *   StaleShell      a deploy left us behind → reload (the reload IS the fix)
 *
 * Assembling these by hand was the same ten lines in every app; user shells
 * hang off the chain with `from: StaleShell` and only ever claim what the
 * app itself owns.
 */
export interface BoundaryShellsOptions {
  /** Shell-name prefix for diagnostics and devtools. Defaults to "boundary". */
  readonly name?: string;
  /** Reaction tap for held transport failures (banner analytics, logging). */
  readonly onTransportError?: (error: ErrorUnion<typeof transportErrors>) => void;
  /**
   * Reaction to a stale client. Defaults to a full page reload — the reload
   * fetches the current client, which is the fix. Override to show an
   * "update available" affordance instead.
   */
  readonly onStale?: (error: ClientStale) => void;
}

export interface BoundaryShells {
  readonly TransportShell: Shell<TagsOf<typeof transportErrors>, Record<never, never>, void, ErrorUnion<typeof transportErrors>>;
  readonly DefectShell: Shell<TagsOf<typeof transportErrors> | TagsOf<typeof defectErrors>, Record<never, never>, void, ErrorUnion<typeof defectErrors>>;
  readonly StaleShell: Shell<TagsOf<typeof transportErrors> | TagsOf<typeof defectErrors> | TagsOf<typeof staleErrors>, Record<never, never>, void, ErrorUnion<typeof staleErrors>>;
  /** Mounts all three in order. Place the React error boundary just inside it. */
  readonly BoundaryProvider: (props: { readonly children?: ReactNode }) => ReactNode;
}

const reloadPage = () => {
  if (typeof location !== "undefined") location.reload();
};

export const boundaryShells = (options: BoundaryShellsOptions = {}): BoundaryShells => {
  const name = options.name ?? "boundary";
  const TransportShell = defineShell({
    name: `${name}-transport`,
    claims: transportErrors,
    ...(options.onTransportError === undefined ? {} : { onError: options.onTransportError }),
  });
  const DefectShell = defineShell({
    name: `${name}-defect`,
    from: TransportShell,
    claims: defectErrors,
    effect: "escalate",
  });
  const StaleShell = defineShell({
    name: `${name}-stale`,
    from: DefectShell,
    claims: staleErrors,
    onError: options.onStale ?? reloadPage,
  });
  const BoundaryProvider = ({ children }: { readonly children?: ReactNode }): ReactNode =>
    createElement(
      TransportShell.Provider,
      undefined,
      createElement(
        DefectShell.Provider,
        undefined,
        createElement(StaleShell.Provider, undefined, children),
      ),
    );
  return { TransportShell, DefectShell, StaleShell, BoundaryProvider } as BoundaryShells;
};

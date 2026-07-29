"use client";

import { createElement, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import {
  defectErrors,
  staleErrors,
  transportErrors,
  type ClientStale,
} from "../framework-errors.js";
import type { ErrorUnion } from "../server/contract.js";
import { getOnlineSnapshot, subscribeConnectivity } from "../connectivity.js";
import { defineShell, type Shell } from "./shell.js";

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
 *
 * `BoundaryProvider` is also the browser bridge: it wires reconnect and
 * focus events so held transport failures resume automatically, and
 * `useConnectivity()` exposes the honest two-source signal the offline
 * banner needs.
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
  /**
   * Retry held transport failures when the browser reports reconnect, and on
   * window focus while failures are held (the honest probe for the captive
   * portals `navigator.onLine` lies about). Defaults to true.
   */
  readonly autoResume?: boolean;
}

export type ConnectivityStatus = "online" | "offline" | "degraded";

export interface Connectivity {
  /**
   * `"offline"` — the browser says so (cause-side hint, lights up before any
   * request fails). `"degraded"` — the browser claims online but the
   * transport shell is holding proven failures. `"online"` — neither.
   */
  readonly status: ConnectivityStatus;
  /** The browser's claim (`navigator.onLine` + events). A hint; it can lie "true". */
  readonly online: boolean;
  /** Operations the transport shell is currently holding — the proof side. */
  readonly held: number;
  /** Most recently held transport failure, for banner copy. */
  readonly latest: ErrorUnion<typeof transportErrors> | undefined;
  /** Retry everything held now — the banner's manual affordance. */
  readonly resume: () => void;
}

type TransportBoundaryShell = Shell<typeof transportErrors, undefined, Record<never, never>, void>;
type DefectBoundaryShell = Shell<
  typeof defectErrors,
  TransportBoundaryShell,
  Record<never, never>,
  void
>;
type StaleBoundaryShell = Shell<
  typeof staleErrors,
  DefectBoundaryShell,
  Record<never, never>,
  void
>;

export interface BoundaryShells {
  readonly TransportShell: TransportBoundaryShell;
  readonly DefectShell: DefectBoundaryShell;
  readonly StaleShell: StaleBoundaryShell;
  /** Mounts all three in order. Place the React error boundary just inside it. */
  readonly BoundaryProvider: (props: { readonly children?: ReactNode }) => ReactNode;
  /** The offline-banner signal. Must be used under `BoundaryProvider`. */
  readonly useConnectivity: () => Connectivity;
}

const reloadPage = () => {
  if (typeof location !== "undefined") location.reload();
};

const FOCUS_RESUME_COOLDOWN_MS = 5_000;

const subscribeOnline = (onStoreChange: () => void) =>
  subscribeConnectivity((event) => {
    if (event !== "focus") onStoreChange();
  });

const serverOnlineSnapshot = () => true;

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

  /**
   * The reconnect arc, closed automatically: claim, hold, the browser comes
   * back, resume. Focus only probes while something is held — and at most
   * once per cooldown window, so alt-tabbing at a downed server never turns
   * into a retry storm. Reconnect always resumes.
   */
  const AutoResume = ({ children }: { readonly children?: ReactNode }): ReactNode => {
    const held = TransportShell.useHeld();
    const heldRef = useRef(held.affected);
    heldRef.current = held.affected;
    const resumeRef = useRef(held.resume);
    resumeRef.current = held.resume;
    const lastResumeAt = useRef(0);
    useEffect(
      () =>
        subscribeConnectivity((event) => {
          if (event === "offline" || heldRef.current === 0) return;
          const now = Date.now();
          if (event === "focus" && now - lastResumeAt.current < FOCUS_RESUME_COOLDOWN_MS) return;
          lastResumeAt.current = now;
          resumeRef.current();
        }),
      [],
    );
    return children;
  };

  const BoundaryProvider = ({ children }: { readonly children?: ReactNode }): ReactNode =>
    createElement(
      TransportShell.Provider,
      undefined,
      createElement(
        DefectShell.Provider,
        undefined,
        createElement(
          StaleShell.Provider,
          undefined,
          options.autoResume === false ? children : createElement(AutoResume, undefined, children),
        ),
      ),
    );

  const useConnectivity = (): Connectivity => {
    const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, serverOnlineSnapshot);
    const held = TransportShell.useHeld();
    return {
      status: !online ? "offline" : held.affected > 0 ? "degraded" : "online",
      online,
      held: held.affected,
      latest: held.latest,
      resume: held.resume,
    };
  };

  return {
    TransportShell,
    DefectShell,
    StaleShell,
    BoundaryProvider,
    useConnectivity,
  } as BoundaryShells;
};

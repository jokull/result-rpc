/**
 * One shared browser-connectivity source for every consumer that needs it:
 * the query engine (paused retries continue on reconnect), boundary shells
 * (held transport failures resume), subscriptions (paused streams reconnect),
 * and the UI (the "you're offline" banner).
 *
 * Adjacency isn't identity: browser connectivity is a cause-side *hint*,
 * transport errors are *outcomes*. This module never mints or suppresses
 * error tags and never touches the cache — it only times resumes and informs
 * rendering. `navigator.onLine` can lie "true" (captive portals), which is
 * why focus events double as a resume probe while failures are held.
 */

export type ConnectivityEvent = "online" | "offline" | "focus";

type ConnectivityListener = (event: ConnectivityEvent) => void;

interface EventTargetLike {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

const listeners = new Set<ConnectivityListener>();
let online = typeof navigator === "undefined" || navigator.onLine !== false;
let detach: (() => void) | undefined;

const emit = (event: ConnectivityEvent) => {
  if (event === "online") online = true;
  if (event === "offline") online = false;
  for (const listener of [...listeners]) listener(event);
};

const attach = () => {
  const target: EventTargetLike = globalThis;
  if (!target.addEventListener) return;
  const onOnline = () => emit("online");
  const onOffline = () => emit("offline");
  const onFocus = () => emit("focus");
  const onVisible = () => {
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      emit("focus");
    }
  };
  target.addEventListener("online", onOnline);
  target.addEventListener("offline", onOffline);
  target.addEventListener("focus", onFocus);
  const doc: EventTargetLike | undefined = typeof document === "undefined" ? undefined : document;
  doc?.addEventListener?.("visibilitychange", onVisible);
  detach = () => {
    target.removeEventListener?.("online", onOnline);
    target.removeEventListener?.("offline", onOffline);
    target.removeEventListener?.("focus", onFocus);
    doc?.removeEventListener?.("visibilitychange", onVisible);
    detach = undefined;
  };
};

/**
 * Subscribe to connectivity transitions. Browser listeners attach on the
 * first subscriber and detach on the last, so SSR and node test runs that
 * never subscribe pay nothing.
 */
export const subscribeConnectivity = (listener: ConnectivityListener): (() => void) => {
  if (listeners.size === 0) attach();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach?.();
  };
};

/** The browser's current claim. A hint — it can lie "true", never trust it over outcomes. */
export const getOnlineSnapshot = (): boolean => online;

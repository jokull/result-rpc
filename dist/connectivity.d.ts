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
/**
 * Subscribe to connectivity transitions. Browser listeners attach on the
 * first subscriber and detach on the last, so SSR and node test runs that
 * never subscribe pay nothing.
 */
export declare const subscribeConnectivity: (listener: ConnectivityListener) => (() => void);
/** The browser's current claim. A hint — it can lie "true", never trust it over outcomes. */
export declare const getOnlineSnapshot: () => boolean;
export {};

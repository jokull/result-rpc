/**
 * Bun has no window and navigator.onLine is undefined, so the connectivity
 * arc (offline -> paused -> online -> resume) needs a minimal browser stand-in
 * installed before the library is imported. Import this module first.
 */
const netState = { online: true };

class TrackerWindow extends EventTarget {}
const win = new TrackerWindow();

const nav = {
  get onLine() {
    return netState.online;
  },
  userAgent: "bun-test",
};

const doc = new EventTarget() as EventTarget & { visibilityState: string };
doc.visibilityState = "visible";

(win as unknown as Record<string, unknown>).navigator = nav;
(win as unknown as Record<string, unknown>).document = doc;
(globalThis as Record<string, unknown>).window = win;
(globalThis as Record<string, unknown>).document = doc;
Object.defineProperty(globalThis, "navigator", {
  value: nav,
  configurable: true,
  writable: true,
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// result-rpc's connectivity source attaches its listeners to globalThis (not
// window) — discovered by reading src/connectivity.ts; see FRICTION.md.
function broadcast(event: Event): void {
  win.dispatchEvent(event);
  (globalThis as unknown as EventTarget).dispatchEvent?.(new Event(event.type));
}

export function goOffline(): void {
  netState.online = false;
  broadcast(new Event("offline"));
}

export function goOnline(): void {
  netState.online = true;
  broadcast(new Event("online"));
}

export function isSimulatedOnline(): boolean {
  return netState.online;
}

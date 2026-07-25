/**
 * Bun has no window and navigator.onLine is undefined, so the library's
 * connectivity source needs a minimal always-online browser stand-in
 * installed before the library is imported. Import this module first.
 * (Same shim as examples/07-tracker, minus the offline toggles — this
 * example never goes offline.)
 */
class BookingsWindow extends EventTarget {}
const win = new BookingsWindow();

const nav = {
  onLine: true,
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

export {};

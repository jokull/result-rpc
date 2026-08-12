//#region src/connectivity.ts
const listeners = /* @__PURE__ */ new Set();
let online = typeof navigator === "undefined" || navigator.onLine !== false;
let detach;
const emit = (event) => {
	if (event === "online") online = true;
	if (event === "offline") online = false;
	for (const listener of [...listeners]) listener(event);
};
const attach = () => {
	const target = globalThis;
	if (!target.addEventListener) return;
	const onOnline = () => emit("online");
	const onOffline = () => emit("offline");
	const onFocus = () => emit("focus");
	const onVisible = () => {
		if (typeof document === "undefined" || document.visibilityState === "visible") emit("focus");
	};
	target.addEventListener("online", onOnline);
	target.addEventListener("offline", onOffline);
	target.addEventListener("focus", onFocus);
	const doc = typeof document === "undefined" ? void 0 : document;
	doc?.addEventListener?.("visibilitychange", onVisible);
	detach = () => {
		target.removeEventListener?.("online", onOnline);
		target.removeEventListener?.("offline", onOffline);
		target.removeEventListener?.("focus", onFocus);
		doc?.removeEventListener?.("visibilitychange", onVisible);
		detach = void 0;
	};
};
/**
* Subscribe to connectivity transitions. Browser listeners attach on the
* first subscriber and detach on the last, so SSR and node test runs that
* never subscribe pay nothing.
*/
const subscribeConnectivity = (listener) => {
	if (listeners.size === 0) attach();
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) detach?.();
	};
};
/** The browser's current claim. A hint — it can lie "true", never trust it over outcomes. */
const getOnlineSnapshot = () => online;
//#endregion
export { getOnlineSnapshot, subscribeConnectivity };

//# sourceMappingURL=connectivity.js.map
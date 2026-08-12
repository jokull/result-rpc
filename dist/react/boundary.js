"use client";
import { defectErrors, staleErrors, transportErrors } from "../framework-errors.js";
import { getOnlineSnapshot, subscribeConnectivity } from "../connectivity.js";
import { defineShell } from "./shell.js";
import { createElement, useEffect, useRef, useSyncExternalStore } from "react";
//#region src/react/boundary.tsx
const reloadPage = () => {
	if (typeof location !== "undefined") location.reload();
};
const FOCUS_RESUME_COOLDOWN_MS = 5e3;
const subscribeOnline = (onStoreChange) => subscribeConnectivity((event) => {
	if (event !== "focus") onStoreChange();
});
const serverOnlineSnapshot = () => true;
const boundaryShells = (options = {}) => {
	const name = options.name ?? "boundary";
	const TransportShell = defineShell({
		name: `${name}-transport`,
		claims: transportErrors,
		...options.onTransportError === void 0 ? {} : { onError: options.onTransportError }
	});
	const DefectShell = defineShell({
		name: `${name}-defect`,
		from: TransportShell,
		claims: defectErrors,
		effect: "escalate"
	});
	const StaleShell = defineShell({
		name: `${name}-stale`,
		from: DefectShell,
		claims: staleErrors,
		onError: options.onStale ?? reloadPage
	});
	/**
	* The reconnect arc, closed automatically: claim, hold, the browser comes
	* back, resume. Focus only probes while something is held — and at most
	* once per cooldown window, so alt-tabbing at a downed server never turns
	* into a retry storm. Reconnect always resumes.
	*/
	const AutoResume = ({ children }) => {
		const held = TransportShell.useHeld();
		const heldRef = useRef(held.affected);
		heldRef.current = held.affected;
		const resumeRef = useRef(held.resume);
		resumeRef.current = held.resume;
		const lastResumeAt = useRef(0);
		useEffect(() => subscribeConnectivity((event) => {
			if (event === "offline" || heldRef.current === 0) return;
			const now = Date.now();
			if (event === "focus" && now - lastResumeAt.current < FOCUS_RESUME_COOLDOWN_MS) return;
			lastResumeAt.current = now;
			resumeRef.current();
		}), []);
		return children;
	};
	const BoundaryProvider = ({ children }) => createElement(TransportShell.Provider, void 0, createElement(DefectShell.Provider, void 0, createElement(StaleShell.Provider, void 0, options.autoResume === false ? children : createElement(AutoResume, void 0, children))));
	const useConnectivity = () => {
		const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, serverOnlineSnapshot);
		const held = TransportShell.useHeld();
		return {
			status: !online ? "offline" : held.affected > 0 ? "degraded" : "online",
			online,
			held: held.affected,
			latest: held.latest,
			resume: held.resume
		};
	};
	return {
		TransportShell,
		DefectShell,
		StaleShell,
		BoundaryProvider,
		useConnectivity
	};
};
//#endregion
export { boundaryShells };

//# sourceMappingURL=boundary.js.map
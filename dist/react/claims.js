import { createContext, useContext, useEffect, useId, useMemo, useRef } from "react";
//#region src/react/claims.ts
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
const createSuspenseClaimLease = () => {
	const token = Object.freeze({});
	const holdings = /* @__PURE__ */ new Map();
	let active = true;
	return {
		token,
		activate: () => {
			active = true;
		},
		isActive: () => active,
		retain: (entry, operationId) => {
			if (!active) return;
			const operations = holdings.get(entry) ?? /* @__PURE__ */ new Set();
			operations.add(operationId);
			holdings.set(entry, operations);
		},
		forget: (entry, operationId) => {
			const operations = holdings.get(entry);
			if (!operations) return;
			operations.delete(operationId);
			if (operations.size === 0) holdings.delete(entry);
		},
		release: () => {
			active = false;
			for (const [entry, operations] of holdings) for (const operationId of operations) entry.release(operationId, token);
			holdings.clear();
		}
	};
};
const SuspenseClaimLeaseContext = createContext(null);
const useSuspenseClaimLease = () => useContext(SuspenseClaimLeaseContext);
/** Mounted claim scopes, outermost first. Providers append themselves. */
const ClaimScopeContext = createContext([]);
const ownerOf = (entries, error) => {
	if (!error) return void 0;
	return claimOwner(entries, error);
};
/**
* One stable operation bridge shared by ordinary and Suspense hooks.
*
* `render` is deliberately pure. Ordinary acquisitions happen from a
* committed effect or external observer notification. A relevant Suspense
* retry acquires only when its thrown `wait()` promise runs, under the
* committed boundary lease supplied by `ResultSuspense`. Request settlement
* itself only populates cache state and can never acquire ownership.
*/
const useClaimObserver = (onClaimed, retry, operationId, suspenseLease) => {
	const entries = useContext(ClaimScopeContext);
	const reactId = useId();
	const aggregateId = operationId ?? reactId;
	const localLease = useRef({});
	const leaseId = suspenseLease?.token ?? localLease.current;
	const entriesRef = useRef(entries);
	entriesRef.current = entries;
	const onClaimedRef = useRef(onClaimed);
	onClaimedRef.current = onClaimed;
	const retryRef = useRef(retry);
	retryRef.current = retry;
	const observer = useMemo(() => {
		let current;
		let currentError;
		const ownerForExternalNotification = (error) => {
			if (!error) return void 0;
			const resolution = resolveClaimOwner(entriesRef.current, error);
			return resolution.state === "owned" ? resolution.owner : void 0;
		};
		const releaseFrom = (entry) => {
			entry.release(aggregateId, leaseId);
			suspenseLease?.forget(entry, aggregateId);
		};
		const release = () => {
			if (current) releaseFrom(current);
			current = void 0;
			currentError = void 0;
			for (const entry of entriesRef.current) releaseFrom(entry);
		};
		const acquire = (error) => {
			const owner = ownerForExternalNotification(error);
			if (!owner || !error || owner.effect === "escalate") {
				release();
				return;
			}
			if (suspenseLease === null) throw new TypeError("A shell-claimed useResultSuspenseQuery must be rendered inside <ResultSuspense>");
			if (suspenseLease && !suspenseLease.isActive()) return void 0;
			if (current && (current !== owner || currentError !== error)) releaseFrom(current);
			current = owner;
			currentError = error;
			const acquired = owner.acquire(aggregateId, leaseId, error, () => retryRef.current?.());
			suspenseLease?.retain(owner, aggregateId);
			if (acquired.fresh) onClaimedRef.current?.(owner, error);
			return acquired;
		};
		return {
			render: (error) => {
				const owner = ownerOf(entriesRef.current, error);
				if (!owner || !error) return void 0;
				if (owner.effect === "escalate") throw error;
				return {
					entry: owner,
					wait: () => {
						if (suspenseLease === null) throw new TypeError("A shell-claimed useResultSuspenseQuery must be rendered inside <ResultSuspense>");
						return Promise.resolve().then(() => acquire(error)?.resumed);
					}
				};
			},
			notify: (error) => {
				acquire(error);
			},
			release
		};
	}, [
		aggregateId,
		leaseId,
		suspenseLease
	]);
	useEffect(() => () => observer.release(), [observer]);
	return observer;
};
/**
* Consults the mounted claim scope for a failure. Escalating owners throw the
* reified tagged error instance (after hooks, so hook order is stable); pausing
* owners hold the error — reported for aggregate views — and the caller
* projects a non-terminal state.
*/
const useAmbientClaim = (observer, error) => {
	useEffect(() => {
		observer.notify(error);
	}, [observer, error]);
	return observer.render(error);
};
/** Reads the mounted scope for imperative checks (mutation promises). */
const useClaimScope = () => useContext(ClaimScopeContext);
/** Total exact-definition lookup for use inside external callback machinery. */
const resolveClaimOwner = (entries, error) => {
	const tag = error._tag;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry.registry.definitions.get(tag)) continue;
		if (!entry.registry.is(error)) return {
			state: "incompatible",
			error: /* @__PURE__ */ new TypeError(`Shell ${entry.name} claims ${tag} with a different error definition`)
		};
		return {
			state: "owned",
			owner: entry
		};
	}
	return { state: "unclaimed" };
};
/** Innermost mounted exact owner, throwing a fail-loud identity diagnostic. */
const claimOwner = (entries, error) => {
	const resolution = resolveClaimOwner(entries, error);
	if (resolution.state === "incompatible") throw resolution.error;
	return resolution.state === "owned" ? resolution.owner : void 0;
};
/**
* The non-terminal projection of a claimed query failure: stale success keeps
* rendering; otherwise the operation returns to pending with fetch paused.
*/
const pauseQueryProjection = (state) => {
	const controls = {
		fetch: "paused",
		failureCount: state.failureCount,
		isStale: state.isStale,
		updatedAt: state.updatedAt,
		refetch: state.refetch
	};
	const previous = state.state === "failure" ? state.previous : void 0;
	return previous === void 0 ? {
		...controls,
		state: "pending"
	} : {
		...controls,
		state: "success",
		value: previous
	};
};
//#endregion
export { ClaimScopeContext, SuspenseClaimLeaseContext, claimOwner, createSuspenseClaimLease, pauseQueryProjection, resolveClaimOwner, useAmbientClaim, useClaimObserver, useClaimScope, useSuspenseClaimLease };

//# sourceMappingURL=claims.js.map
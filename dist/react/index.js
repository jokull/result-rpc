"use client";
import { SERIALIZER_VERSION, serialize } from "../serializer.js";
import { ClientStale, defectErrors, staleErrors, transportErrors } from "../framework-errors.js";
import { normalizeClientCallInput } from "../client/base-client.js";
import { getClientIdentity, getProcedureClientMetadata } from "../client/client-metadata.js";
import { claimed } from "../client/transport.js";
import { getClientEventListener } from "../client/client.js";
import { shouldRetryMutation } from "../query/mutation-retry.js";
import { createQueryRuntime, toResult } from "../query/runtime.js";
import { SuspenseClaimLeaseContext, claimOwner, createSuspenseClaimLease, pauseQueryProjection, resolveClaimOwner, useAmbientClaim, useClaimObserver, useClaimScope, useSuspenseClaimLease } from "./claims.js";
import { bindLayerShell, defineShell, layerShell, prefetchLayer } from "./shell.js";
import { boundaryShells } from "./boundary.js";
import { Fragment, Suspense, createContext, createElement, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
//#region src/react/index.tsx
function normalizeHookArgs(rest, defaultOptions) {
	return [normalizeClientCallInput(rest), rest[1] ?? defaultOptions];
}
const RuntimeContext = createContext(void 0);
const claimRuntimeIds = /* @__PURE__ */ new WeakMap();
let nextClaimRuntimeId = 1;
const claimRuntimeId = (runtime) => {
	const existing = claimRuntimeIds.get(runtime);
	if (existing !== void 0) return existing;
	const created = nextClaimRuntimeId++;
	claimRuntimeIds.set(runtime, created);
	return created;
};
const queryClaimId = (runtime, key) => `query:${claimRuntimeId(runtime)}:${key[0].length}:${key[0]}:${key[1]}`;
const pendingOwnedRuntimeCleanup = /* @__PURE__ */ new WeakMap();
const useOwnedRuntimeCleanup = (runtime) => {
	useEffect(() => {
		if (runtime === void 0) return;
		pendingOwnedRuntimeCleanup.delete(runtime);
		return () => {
			const token = {};
			pendingOwnedRuntimeCleanup.set(runtime, token);
			queueMicrotask(() => {
				if (pendingOwnedRuntimeCleanup.get(runtime) !== token) return;
				pendingOwnedRuntimeCleanup.delete(runtime);
				runtime.clear();
			});
		};
	}, [runtime]);
};
/**
* Provides the query runtime. Pass `client` to let the provider own a runtime
* for the component's lifetime — the common case. Pass `runtime` when the app
* needs the instance elsewhere (SSR prefetch, imperative cache access).
*/
const useProvidedRuntime = (props) => {
	const ownedRef = useRef(void 0);
	if (props.runtime === void 0 && ownedRef.current?.client !== props.client) ownedRef.current = {
		client: props.client,
		runtime: createQueryRuntime({ client: props.client })
	};
	const owned = props.runtime === void 0 ? ownedRef.current?.runtime : void 0;
	useOwnedRuntimeCleanup(owned);
	const runtime = props.runtime ?? owned;
	if (runtime === void 0) throw new TypeError("ResultRpcProvider requires client or runtime");
	const hydrated = useRef(void 0);
	if (props.hydrate !== void 0 && (hydrated.current?.runtime !== runtime || hydrated.current.state !== props.hydrate)) {
		hydrated.current = {
			runtime,
			state: props.hydrate
		};
		try {
			runtime.hydrate(props.hydrate);
		} catch (cause) {
			warnHydrationSkew(cause);
		}
	}
	return runtime;
};
const ResultRpcProviderImpl = (props) => {
	const runtime = useProvidedRuntime(props);
	return createElement(RuntimeContext.Provider, { value: runtime }, props.children);
};
/** Provider constrained to the globally registered client, when one exists. */
const ResultRpcProvider = (props) => ResultRpcProviderImpl(props);
const useRuntime = () => {
	const runtime = useContext(RuntimeContext);
	if (!runtime) throw new TypeError("useResultQuery requires ResultRpcProvider");
	return runtime;
};
/** The enclosing provider's runtime, for imperative cache operations. */
const useResultRuntime = () => useRuntime();
let hydrationSkewWarned = false;
const warnHydrationSkew = (cause) => {
	const processValue = Reflect.get(globalThis, "process");
	const env = processValue !== null && typeof processValue === "object" ? Reflect.get(processValue, "env") : void 0;
	if (env !== null && typeof env === "object" && Reflect.get(env, "NODE_ENV") === "production" || hydrationSkewWarned) return;
	hydrationSkewWarned = true;
	console.warn("[result-rpc] skipped hydrating a dehydrated cache — its serializer/contract version did not match this client (a server and client bundle briefly skewed across a deploy). The client will fetch fresh instead of rendering stale server data. Original error: " + (cause instanceof Error ? cause.message : String(cause)));
};
/**
* Merges server-prefetched cache state into the enclosing runtime — the App
* Router idiom. Unlike the provider's one-shot `hydrate` prop, a boundary is
* nestable: each route segment's server component can prefetch, dehydrate, and
* render its own boundary, and every payload merges into the one client
* runtime. Hydrated entities are indexed exactly as fetched ones are, so a
* client mutation patches server-rendered rows with zero refetch.
*
* Hydration happens during render (before children read the cache, so the
* first paint has the data), once per distinct `state`, and never crashes the
* tree: a serializer/contract-version mismatch across a deploy is skipped with
* a dev warning and the client fetches fresh.
*/
const ResultRpcHydrationBoundary = (props) => {
	const runtime = useRuntime();
	const hydrated = useRef(void 0);
	if (props.state !== void 0 && hydrated.current !== props.state) {
		hydrated.current = props.state;
		try {
			runtime.hydrate(props.state);
		} catch (cause) {
			warnHydrationSkew(cause);
		}
	}
	return createElement(Fragment, null, props.children);
};
/**
* The client registered by the application and supplied to the enclosing
* ResultRpcProvider.
*
*     declare module "result-rpc/react" {
*       interface Register { client: AppClient }
*     }
*
*     const client = useResultClient()
*/
const useResultClient = () => useRuntime().client;
/**
* A scoped binding for repositories that compile several independent apps in
* one TypeScript program. Normal applications can use `Register`; this binds
* the same guarantees without global declaration merging.
*/
const createResultRpcReact = () => {
	const ScopedRuntimeContext = createContext(void 0);
	const useScopedRuntime = () => {
		const runtime = useContext(ScopedRuntimeContext);
		if (!runtime) throw new TypeError("Scoped result-rpc hook requires its matching provider");
		return runtime;
	};
	const useClient = () => useScopedRuntime().client;
	const Provider = (props) => {
		const runtime = useProvidedRuntime(props);
		return createElement(RuntimeContext.Provider, { value: runtime }, createElement(ScopedRuntimeContext.Provider, { value: runtime }, props.children));
	};
	return Object.freeze({
		ResultRpcProvider: Provider,
		useResultClient: useClient,
		useResultRuntime: useScopedRuntime,
		layerShell: bindLayerShell(useClient)
	});
};
/** Builds the pause-holding breadcrumb notifier for a procedure, if a listener exists. */
const useClaimNotifier = (procedure) => {
	const identity = getClientIdentity(useRuntime().client);
	const listener = identity ? getClientEventListener(identity) : void 0;
	const path = getProcedureClientMetadata(procedure)?.path;
	return useMemo(() => {
		if (!listener || path === void 0) return void 0;
		return (entry, error) => {
			if (entry.effect !== "pause") return;
			listener({
				type: "claimed",
				path,
				tag: error._tag,
				owner: entry.name,
				effect: "pause"
			});
		};
	}, [listener, path]);
};
const useResultQueryResolvedWithClaim = (procedure, input, options, suspenseLease) => {
	const runtime = useRuntime();
	const inputKey = runtime.cache.key(procedure, input)[1];
	const queryOptionsRef = useRef(options);
	queryOptionsRef.current = options;
	const observer = useMemo(() => {
		const dynamicOptions = {
			...options.enabled === void 0 ? {} : { enabled: options.enabled },
			...options.staleTime === void 0 ? {} : { staleTime: options.staleTime },
			...options.gcTime === void 0 ? {} : { gcTime: options.gcTime },
			get retry() {
				return queryOptionsRef.current.retry;
			}
		};
		return runtime.observe(procedure, input, dynamicOptions);
	}, [
		runtime,
		procedure,
		inputKey,
		options.enabled,
		options.staleTime,
		options.gcTime
	]);
	const observerRef = useRef(observer);
	observerRef.current = observer;
	const committedObserverRef = useRef(void 0);
	const notifyClaim = useClaimNotifier(procedure);
	const [retryHeld] = useState(() => async () => {
		await observerRef.current.refetch();
	});
	const claimObserver = useClaimObserver(notifyClaim, retryHeld, queryClaimId(runtime, observer.key), suspenseLease);
	const subscribe = useMemo(() => (listener) => observer.subscribe(() => {
		const next = observer.getCurrentState();
		try {
			claimObserver.notify(next.state === "failure" ? next.error : void 0);
		} finally {
			listener();
		}
	}), [observer, claimObserver]);
	useEffect(() => {
		committedObserverRef.current = observer;
		return () => {
			if (committedObserverRef.current === observer) committedObserverRef.current = void 0;
			observer.destroy();
		};
	}, [observer]);
	const state = useSyncExternalStore(subscribe, observer.getCurrentState, observer.getCurrentState);
	const claim = useAmbientClaim(claimObserver, state.state === "failure" ? state.error : void 0);
	const [settleForSuspense] = useState(() => async () => {
		const suspenseObserver = observerRef.current;
		try {
			await suspenseObserver.refetch();
		} finally {
			if (committedObserverRef.current !== suspenseObserver) suspenseObserver.destroy();
		}
	});
	return [
		claim ? pauseQueryProjection(state) : state,
		claim,
		settleForSuspense
	];
};
const useResultQueryWithClaim = (procedure, ...rest) => {
	const [input, options] = normalizeHookArgs(rest, {});
	const [state, claim] = useResultQueryResolvedWithClaim(procedure, input, options, void 0);
	return [state, claim];
};
const useResultQuery = (procedure, ...rest) => useResultQueryWithClaim(procedure, ...rest)[0];
/**
* A claim-paused paginated projection: an enclosing shell owns the failure,
* so this hook shows the previous rows (or pending) while the shell decides.
* Same doctrine as `pauseQueryProjection` for unary queries.
*/
const pausePaginatedProjection = (state) => {
	const controls = {
		fetch: "paused",
		failureCount: state.failureCount,
		isStale: state.isStale,
		updatedAt: state.updatedAt,
		pageCount: state.pageCount,
		hasNext: state.hasNext,
		fetchingNext: state.fetchingNext,
		refetch: state.refetch,
		fetchNext: state.fetchNext
	};
	const previous = state.state === "failure" ? state.previous : void 0;
	return previous === void 0 ? {
		...controls,
		state: "pending"
	} : {
		...controls,
		state: "success",
		rows: previous
	};
};
/**
* Observes a `.paginate()` procedure: one cache entry per list input, every
* loaded page flattened into `rows` (deduplicated by entity identity),
* `fetchNext()` to extend, `refetch()` to sequentially converge the whole
* loaded window. Ambient shells claim failures exactly like `useResultQuery`;
* use `Shell.usePaginatedQuery` when the return type should subtract them too.
*/
const useResultPaginatedQuery = (procedure, input, options = {}) => {
	const runtime = useRuntime();
	const inputKey = serialize(input);
	if (!inputKey.ok) throw new TypeError("Paginated query input is not wire-serializable");
	const queryOptionsRef = useRef(options);
	queryOptionsRef.current = options;
	const observer = useMemo(() => {
		const dynamicOptions = {
			...options.enabled === void 0 ? {} : { enabled: options.enabled },
			...options.staleTime === void 0 ? {} : { staleTime: options.staleTime },
			...options.gcTime === void 0 ? {} : { gcTime: options.gcTime },
			get retry() {
				return queryOptionsRef.current.retry;
			}
		};
		return runtime.observePaginated(procedure, input, dynamicOptions);
	}, [
		runtime,
		procedure,
		inputKey.value,
		options.enabled,
		options.staleTime,
		options.gcTime
	]);
	const observerRef = useRef(observer);
	observerRef.current = observer;
	const notifyClaim = useClaimNotifier(procedure);
	const [retryHeld] = useState(() => async () => {
		await observerRef.current.refetch();
	});
	const claimObserver = useClaimObserver(notifyClaim, retryHeld, queryClaimId(runtime, observer.key));
	const subscribe = useMemo(() => (listener) => observer.subscribe(() => {
		const next = observer.getCurrentState();
		try {
			claimObserver.notify(next.state === "failure" ? next.error : void 0);
		} finally {
			listener();
		}
	}), [observer, claimObserver]);
	useEffect(() => () => observer.destroy(), [observer]);
	const state = useSyncExternalStore(subscribe, observer.getCurrentState, observer.getCurrentState);
	return useAmbientClaim(claimObserver, state.state === "failure" ? state.error : void 0) ? pausePaginatedProjection(state) : state;
};
/**
* Suspense plus a committed lifecycle owner for shell-claimed failures.
* A child that suspends before commit cannot install its own cleanup, so a
* result-rpc suspense query which may be claimed belongs inside this boundary.
*/
const ResultSuspense = ({ resetKey, children, ...props }) => {
	const scope = useMemo(() => ({
		resetKey,
		lease: createSuspenseClaimLease()
	}), [resetKey]);
	useEffect(() => {
		scope.lease.activate();
		return () => scope.lease.release();
	}, [scope]);
	return createElement(Suspense, props, createElement(SuspenseClaimLeaseContext.Provider, { value: scope.lease }, children));
};
const useResultSuspenseQuery = (procedure, ...rest) => {
	const [input, options] = normalizeHookArgs(rest, {});
	const suspenseLease = useSuspenseClaimLease();
	const [state, claim, settle] = useResultQueryResolvedWithClaim(procedure, input, {
		...options,
		enabled: true
	}, suspenseLease);
	if (state.state === "pending") throw claim ? claim.wait() : settle();
	return state;
};
const useResultMutation = (procedure, options = {}) => {
	const runtime = useRuntime();
	const scope = useClaimScope();
	const scopeRef = useRef(scope);
	scopeRef.current = scope;
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const definitions = useMemo(() => {
		const metadata = getProcedureClientMetadata(procedure);
		if (!metadata) throw new TypeError("Expected a registered result-rpc mutation client");
		return metadata.procedure._def.definitions;
	}, [procedure]);
	const observer = useMemo(() => {
		return runtime.mutation(procedure, {
			get retry() {
				return (error, failureCount) => {
					if (resolveClaimOwner(scopeRef.current, error).state !== "unclaimed") return false;
					return shouldRetryMutation(definitions, optionsRef.current.retry, failureCount, error);
				};
			},
			optimistic: (input, cache) => optionsRef.current.optimistic?.(input, cache),
			onSuccess: (value, input) => optionsRef.current.onSuccess?.(value, input),
			onFailure: (error, input, context, cache) => {
				if (resolveClaimOwner(scopeRef.current, error).state !== "unclaimed") return optionsRef.current.onCancel?.(input, context, cache);
				return optionsRef.current.onFailure?.(error, input, context, cache);
			},
			onCancel: (input, context, cache) => optionsRef.current.onCancel?.(input, context, cache),
			onSettled: (result, input, context, cache) => {
				if (!result.isOk() && resolveClaimOwner(scopeRef.current, result.error).state !== "unclaimed") return;
				return optionsRef.current.onSettled?.(result, input, context, cache);
			}
		});
	}, [
		runtime,
		procedure,
		definitions
	]);
	const observerRef = useRef(observer);
	observerRef.current = observer;
	const notifyClaim = useClaimNotifier(procedure);
	const [resetHeld] = useState(() => () => observerRef.current.reset());
	const claimObserver = useClaimObserver(notifyClaim, resetHeld);
	const subscribe = useMemo(() => (listener) => observer.subscribe(() => {
		const next = observer.getCurrentState();
		try {
			claimObserver.notify(next.state === "failure" ? next.error : void 0);
		} finally {
			listener();
		}
	}), [observer, claimObserver]);
	useEffect(() => () => observer.destroy(), [observer]);
	const state = useSyncExternalStore(subscribe, observer.getCurrentState, observer.getCurrentState);
	const stateRef = useRef(state);
	stateRef.current = state;
	const [mutateAsync] = useState(() => async (input) => {
		const result = await stateRef.current.mutateAsync(input);
		if (!result.isOk()) {
			const tag = result.error._tag;
			const owner = claimOwner(scopeRef.current, result.error);
			if (owner) throw claimed({
				tag,
				owner: owner.name
			});
		}
		return result;
	});
	const [mutate] = useState(() => (input) => void mutateAsync(input).catch(() => void 0));
	if (!useAmbientClaim(claimObserver, state.state === "failure" ? state.error : void 0)) return {
		...state,
		mutate,
		mutateAsync
	};
	return {
		...state.variables === void 0 ? {} : { variables: state.variables },
		mutate,
		mutateAsync,
		cancel: state.cancel,
		reset: state.reset,
		state: "idle"
	};
};
const useResultSubscription = (procedure, ...rest) => {
	const [input, options] = normalizeHookArgs(rest, {});
	const runtime = useRuntime();
	const encodedInput = serialize(input);
	if (!encodedInput.ok) throw new TypeError("Subscription input is not wire-serializable");
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const observer = useMemo(() => {
		return runtime.subscription(procedure, input, {
			get retry() {
				return optionsRef.current.retry;
			},
			get retryDelayMs() {
				return optionsRef.current.retryDelayMs;
			}
		});
	}, [
		runtime,
		procedure,
		encodedInput.value
	]);
	const observerRef = useRef(observer);
	observerRef.current = observer;
	const notifyClaim = useClaimNotifier(procedure);
	const [retryHeld] = useState(() => () => observerRef.current.reconnect());
	const claimObserver = useClaimObserver(notifyClaim, retryHeld);
	const state = useSyncExternalStore(useMemo(() => (listener) => observer.subscribe(() => {
		const next = observer.getCurrentState();
		const nextFailure = next.result && next.result.status === "error" ? next.result.error : void 0;
		try {
			claimObserver.notify(nextFailure);
		} finally {
			listener();
		}
	}), [observer, claimObserver]), observer.getCurrentState, observer.getCurrentState);
	if (!useAmbientClaim(claimObserver, state.result && state.result.status === "error" ? state.result.error : void 0)) return state;
	return {
		...state,
		connection: "paused",
		result: void 0
	};
};
//#endregion
export { ClientStale, ResultRpcHydrationBoundary, ResultRpcProvider, ResultSuspense, SERIALIZER_VERSION, boundaryShells, createResultRpcReact, defectErrors, defineShell, layerShell, prefetchLayer, staleErrors, toResult, transportErrors, useResultClient, useResultMutation, useResultPaginatedQuery, useResultQuery, useResultRuntime, useResultSubscription, useResultSuspenseQuery };

//# sourceMappingURL=index.js.map
"use client";
import { isTaggedError } from "../error.js";
import { ClaimScopeContext } from "./claims.js";
import { useResultClient, useResultMutation, useResultPaginatedQuery, useResultQuery, useResultSubscription, useResultSuspenseQuery } from "./index.js";
import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
//#region src/react/shell.tsx
const internals = /* @__PURE__ */ new WeakMap();
const internalsOf = (shell) => {
	const found = internals.get(shell);
	if (!found) throw new TypeError("Expected a result-rpc shell");
	return found;
};
const createNode = (name, registry, onError, valueRef) => {
	const entries = /* @__PURE__ */ new Map();
	const listeners = /* @__PURE__ */ new Set();
	const retryAll = () => {
		const holdings = [...entries.values()];
		if (holdings.length === 0) return;
		entries.clear();
		recompute();
		for (const holding of holdings) {
			const retry = [...holding.leases.values()].find((candidate) => candidate !== void 0);
			try {
				Promise.resolve(retry?.()).then(holding.resolve, holding.resolve);
			} catch {
				holding.resolve();
			}
		}
	};
	let snapshot = Object.freeze({
		latest: void 0,
		errors: Object.freeze([]),
		affected: 0,
		resume: retryAll
	});
	const recompute = () => {
		const errors = [...entries.values()].map((holding) => holding.error);
		snapshot = {
			latest: errors[errors.length - 1],
			errors,
			affected: errors.length,
			resume: retryAll
		};
		for (const listener of listeners) listener();
	};
	const release = (operationId, leaseId) => {
		const holding = entries.get(operationId);
		if (!holding) return;
		holding.leases.delete(leaseId);
		if (holding.leases.size !== 0) return;
		entries.delete(operationId);
		recompute();
		holding.resolve();
	};
	return {
		acquire: (operationId, leaseId, error, retry) => {
			if (!registry.is(error)) throw new TypeError(`Shell ${name} received ${error._tag} from a different error definition`);
			const existing = entries.get(operationId);
			if (existing?.error === error) {
				existing.leases.set(leaseId, retry);
				return {
					fresh: false,
					resumed: existing.resumed
				};
			}
			if (existing) {
				entries.delete(operationId);
				existing.resolve();
			}
			let resolve = () => void 0;
			const resumed = new Promise((resume) => {
				resolve = resume;
			});
			entries.set(operationId, {
				error,
				leases: /* @__PURE__ */ new Map([[leaseId, retry]]),
				resumed,
				resolve
			});
			recompute();
			onError?.(error, valueRef.current);
			return {
				fresh: true,
				resumed
			};
		},
		release,
		clear: () => {
			const holdings = [...entries.values()];
			entries.clear();
			recompute();
			for (const holding of holdings) holding.resolve();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		snapshot: () => snapshot
	};
};
const createShellErrorRegistry = (name, claims) => {
	const definitions = /* @__PURE__ */ new Map();
	for (const definition of Object.values(claims)) {
		const existing = definitions.get(definition.tag);
		if (existing && existing !== definition) throw new TypeError(`Shell ${name} declares two different definitions for ${definition.tag}`);
		definitions.set(definition.tag, definition);
	}
	return Object.freeze({
		definitions,
		is: (value) => isTaggedError(value) && definitions.get(value._tag)?.is(value) === true
	});
};
const createShellCore = (options, createProvider) => {
	const parent = options.parent;
	const parentInternals = parent ? internalsOf(parent) : void 0;
	const ownRegistry = createShellErrorRegistry(options.name, options.claims);
	const ownTags = new Set(ownRegistry.definitions.keys());
	for (const enclosing of parentInternals?.chain ?? []) for (const tag of ownTags) if (enclosing.ownTags.has(tag)) throw new TypeError(`Shell ${options.name} claims ${tag}, already claimed by ${enclosing.name}`);
	const context = createContext(void 0);
	const useOptionalMount = () => useContext(context);
	const effect = options.effect;
	const self = {
		name: options.name,
		effect,
		ownTags,
		registry: ownRegistry,
		useOptionalMount,
		chain: []
	};
	self.chain.push(self, ...parentInternals?.chain ?? []);
	const useParentMount = parentInternals?.useOptionalMount ?? (() => void 0);
	const Mount = ({ value, children }) => {
		const enclosing = useParentMount();
		if (parentInternals && !enclosing) throw new TypeError(`Shell ${options.name} must be mounted inside ${parentInternals.name}`);
		const valueRef = useRef(value);
		valueRef.current = value;
		const [node] = useState(() => createNode(options.name, ownRegistry, options.onError, valueRef));
		useEffect(() => () => node.clear(), [node]);
		const mount = useMemo(() => ({
			node,
			value
		}), [node, value]);
		const parentScope = useContext(ClaimScopeContext);
		const entry = useMemo(() => ({
			name: options.name,
			effect,
			registry: ownRegistry,
			acquire: node.acquire,
			release: node.release
		}), [node]);
		const scope = useMemo(() => [...parentScope, entry], [parentScope, entry]);
		return createElement(context.Provider, { value: mount }, createElement(ClaimScopeContext.Provider, { value: scope }, children));
	};
	const useMount = () => {
		const mount = useOptionalMount();
		if (!mount) throw new TypeError(`Shell ${options.name} is not mounted`);
		return mount;
	};
	const useHeld = () => {
		const { node } = useMount();
		return useSyncExternalStore(node.subscribe, node.snapshot, node.snapshot);
	};
	const Provider = createProvider({
		Mount,
		useHeld
	});
	const claimedDefinitions = /* @__PURE__ */ new Map();
	for (const layer of self.chain) for (const [tag, definition] of layer.registry.definitions) claimedDefinitions.set(tag, definition);
	const shell = {
		$shell: true,
		$errors: {
			definitions: claimedDefinitions,
			is: (value) => self.chain.some((layer) => layer.registry.is(value))
		},
		name: options.name,
		effect,
		claims: options.claims,
		parent: options.parent,
		ownTags: [...ownTags],
		claimedTags: self.chain.flatMap((layer) => [...layer.ownTags]),
		Provider,
		use: () => useMount().value,
		useHeld,
		useQuery: (procedure, ...rest) => {
			useAssertChainMounted(self);
			return useResultQuery(procedure, ...rest);
		},
		useSuspenseQuery: (procedure, ...rest) => {
			useAssertChainMounted(self);
			return useResultSuspenseQuery(procedure, ...rest);
		},
		usePaginatedQuery: (procedure, input, queryOptions) => {
			useAssertChainMounted(self);
			return useResultPaginatedQuery(procedure, input, queryOptions);
		},
		useMutation: (procedure, mutationOptions) => {
			useAssertChainMounted(self);
			return useResultMutation(procedure, mutationOptions);
		},
		useSubscription: (procedure, ...rest) => {
			useAssertChainMounted(self);
			return useResultSubscription(procedure, ...rest);
		}
	};
	internals.set(shell, self);
	return shell;
};
function defineShell(options) {
	if (options.effect === "escalate" && options.onError !== void 0) throw new TypeError(`Escalating shell ${options.name} delegates observability to its React error boundary`);
	if (Object.keys(options.claims).length === 0 && options.provide === void 0) throw new TypeError(`Shell ${options.name} claims no errors and provides no value`);
	const report = options.onError;
	const provide = options.provide;
	return createShellCore({
		name: options.name,
		parent: options.from,
		claims: options.claims,
		effect: options.effect ?? "pause",
		...report === void 0 ? {} : { onError: (error, value) => report(error, value) }
	}, ({ Mount }) => (props) => {
		return createElement(Mount, { value: provide === void 0 ? void 0 : provide(props) }, props.children);
	});
}
/**
* Eagerly proves the shell's whole chain is mounted. The type subtraction on a
* shell hook is only honest if every claimed tag has a live owner above.
*/
const useAssertChainMounted = (shell) => {
	for (const layer of shell.chain) if (!layer.useOptionalMount()) throw new TypeError(`Shell ${layer.name} is not mounted`);
};
/**
* Derives the React sibling of a shared layer declaration: a shell that loads
* the guaranteed value through the layer's context procedure, provides it to
* the subtree, and claims the layer's error union.
*
* The load itself runs under the enclosing shell (`from:`), so ambient and
* defect failures during load are owned by the layers that already claim them;
* only the layer's own errors reach `onError`.
*/
const createLayerShell = (useClient, layer, options) => {
	const resolveProcedure = (client) => options.select === void 0 ? options.procedure : options.select(client);
	const shell = createShellCore({
		name: layer.name,
		parent: options.from,
		claims: layer.errors,
		effect: "pause",
		...options.onError === void 0 ? {} : { onError: (error, value) => options.onError?.(error, value) }
	}, ({ Mount, useHeld }) => {
		/**
		* Re-establishment resumes: a fresh context value retries every operation
		* held by this exact provider mount. Sibling mounts have independent nodes.
		*/
		const AutoResume = ({ stamp, children }) => {
			const active = useHeld();
			const resumeRef = useRef(active.resume);
			resumeRef.current = active.resume;
			const previous = useRef(stamp);
			useEffect(() => {
				if (stamp === previous.current) return;
				previous.current = stamp;
				resumeRef.current();
			}, [stamp]);
			return children;
		};
		return ({ children, fallback }) => {
			useAssertChainMounted(internalsOf(options.from));
			const load = useResultQuery(resolveProcedure(useClient()), {}, options.load ?? {});
			const failure = load.state === "failure" ? load.error : void 0;
			useEffect(() => {
				if (failure && !options.from.$errors.is(failure)) options.onError?.(failure, void 0);
			}, [failure]);
			if (load.state !== "success") return fallback ?? null;
			return createElement(Mount, { value: load.value }, createElement(AutoResume, { stamp: load.updatedAt }, children));
		};
	});
	return Object.assign(shell, {
		layer,
		resolveProcedure
	});
};
/** The globally registered, TanStack-style layer-shell constructor. */
const layerShell = (layer, options) => createLayerShell(useResultClient, layer, options);
function bindLayerShell(useClient) {
	return (layer, options) => createLayerShell(useClient, layer, options);
}
/** Prefetches the empty-input context procedure retained by a typed layer shell. */
const prefetchLayer = (runtime, shell, client) => {
	const procedure = shell.resolveProcedure(client);
	return runtime.prefetch(procedure, {});
};
//#endregion
export { bindLayerShell, defineShell, layerShell, prefetchLayer };

//# sourceMappingURL=shell.js.map
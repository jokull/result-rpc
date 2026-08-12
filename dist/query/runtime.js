import { err, ok } from "../result.js";
import { encodeProcedureInput } from "../wire.js";
import { DEFAULT_MAX_WIRE_BYTES, SERIALIZER_VERSION, deserialize, serialize } from "../serializer.js";
import { isTaggedError } from "../error.js";
import { frameworkErrorDefinitions } from "../framework-errors.js";
import { collectEntities, entityBrandOf, entityIdFor, entityIdOf, entityKey, isEntityRecord, mergeByExistingKeys, patchEntity, shareStructural } from "../model.js";
import { getClientContractVersion, getClientIdentity, getClientRouter, getProcedureClientMetadata, getTouchedEntities } from "../client/client-metadata.js";
import { getOnlineSnapshot, subscribeConnectivity } from "../connectivity.js";
import { isCancelled } from "../client/transport.js";
import { definitionFor, shouldRetryMutation } from "./mutation-retry.js";
import { CancelledError, InfiniteQueryObserver, MutationObserver, QueryClient, QueryObserver, dehydrate, hydrate, onlineManager } from "@tanstack/query-core";
//#region src/query/runtime.ts
/**
* Make the shared connectivity source the single event source for
* query-core's online manager, and seed its initial state (the manager boots
* assuming online and its default setup listens on `window`, which React
* Native and test runtimes lack). Accurate state is the anti-thrash lever:
* with the default `networkMode: "online"`, fetches and retries *pause*
* while offline instead of failing instantly and burning the retry budget.
*/
let onlineManagerWired = false;
const wireOnlineManager = () => {
	if (onlineManagerWired) return;
	onlineManagerWired = true;
	onlineManager.setEventListener((setOnline) => {
		setOnline(getOnlineSnapshot());
		return subscribeConnectivity((event) => {
			if (event === "online") setOnline(true);
			if (event === "offline") setOnline(false);
		});
	});
};
/**
* Audited callable boundary for associated-type existentials. The generic API
* has already correlated `input` with this exact client's carrier; `never`
* prevents callers that only hold an erased constraint from inventing one.
*/
const invokeProcedureClient = (procedure, input, options) => procedure(input, options);
const invokePaginatedClient = (procedure, list, cursor, options) => procedure({
	list,
	cursor
}, options);
const decodePaginatedPage = (procedure, value) => procedure._def.output.decode(value);
const normalizePaginatedCursor = (procedure, pagination, value) => {
	if (value === null) return {
		ok: true,
		value: null
	};
	const encoded = encodeProcedureInput(pagination.cursor, value);
	if (!encoded.ok) return encoded;
	return pagination.cursor.decode(encoded.value);
};
const invokeSubscriptionClient = (procedure, input, lastEventId) => procedure(input, lastEventId === void 0 ? void 0 : { lastEventId });
/**
* Whether a query's failure belongs in a hydration payload.
*
* Declared domain errors do: `theme/not-found` is the answer to the query, and
* this library's first claim is that such errors are values. Framework and
* transport failures do not — `client/network-failure` describes one attempt on
* one machine, and shipping it as settled truth would replace a fetch the
* client can retry with a verdict it cannot.
*/
/** The wire shape a dehydrated failure arrives as: `{ _tag, data }`. */
const isEncodedTaggedError = (value) => typeof value === "object" && value !== null && "_tag" in value && "data" in value;
const isDehydratableFailure = (failure) => isTaggedError(failure) && !Object.values(frameworkErrorDefinitions).some((definition) => definition.tag === failure._tag);
const defaultShouldRetry = (definitions, failureCount, failure) => {
	if (!isTaggedError(failure)) return false;
	if (failure._tag === "client/offline" && !getOnlineSnapshot()) return false;
	const retry = definitionFor(definitions, failure)?.policy.retry;
	return (retry === "transient" || retry === "after") && failureCount < 3;
};
/**
* Mutations get a stricter default: a mutation whose connection died
* MID-FLIGHT is ambiguous — the server may have processed it, and a blind
* retry is the double-side-effect bug. Only two failures are safe by
* default:
* - `client/offline`: the transport short-circuits BEFORE sending, so the
*   request provably never left the client;
* - policy `retry: "after"`: the server responded and explicitly scheduled
*   the retry, so it chose not to process the attempt.
* Everything else (network-failure, timeout, 5xx) surfaces immediately.
* Callers with idempotent mutations can opt back in via `retry:`;
* idempotency keys are the roadmap for making full retry the default.
*/
const defaultRetryDelay = (definitions, failureCount, failure) => {
	if (isTaggedError(failure) && definitionFor(definitions, failure)?.policy.retry === "after") {
		const data = failure.data;
		if (data !== null && typeof data === "object" && "retryAfterMs" in data && typeof data.retryAfterMs === "number") return Math.max(0, data.retryAfterMs);
	}
	return Math.min(250 * 2 ** failureCount, 2e3);
};
const project = (observed, refetch) => {
	const controls = {
		fetch: observed.fetchStatus,
		failureCount: observed.failureCount,
		isStale: observed.isStale,
		updatedAt: observed.dataUpdatedAt,
		refetch
	};
	if (observed.status === "pending") return {
		...controls,
		state: "pending"
	};
	if (observed.status === "success") return {
		...controls,
		state: "success",
		value: observed.data
	};
	if (!isTaggedError(observed.error)) throw new TypeError("Query engine received an untagged failure");
	return {
		...controls,
		state: "failure",
		error: observed.error,
		...observed.data === void 0 ? {} : { previous: observed.data }
	};
};
/**
* Flattens `InfiniteData<Page>` into one row list, deduplicating by entity
* identity. Duplicates are cursor drift — an insert/delete slid a row across
* a page boundary between fetches. First occurrence wins positionally;
* field freshness is identity-driven (patches reach the retained row), so
* dropping the later copy loses nothing.
*/
const flattenPages = (data) => {
	if (data === void 0) return void 0;
	const rows = [];
	const seen = /* @__PURE__ */ new Set();
	for (const page of data.pages) for (const item of page.items) {
		if (item !== null && typeof item === "object") {
			const model = entityBrandOf(item);
			if (model) {
				const id = entityIdOf(item, model);
				if (id !== void 0) {
					const key = entityKey(model.name, id);
					if (seen.has(key)) continue;
					seen.add(key);
				}
			}
		}
		rows.push(item);
	}
	return rows;
};
const normalizeInfiniteData = (value, decodePage) => {
	if (value === null || typeof value !== "object" || !("pages" in value)) return void 0;
	if (!Array.isArray(value.pages)) return void 0;
	const pages = [];
	for (const page of value.pages) {
		const decoded = decodePage(page);
		if (!decoded.ok) return void 0;
		pages.push(decoded.value);
	}
	return {
		pages,
		pageParams: "pageParams" in value && Array.isArray(value.pageParams) ? [...value.pageParams] : []
	};
};
function toResult(state) {
	if (state.state === "success") return ok(state.value);
	if (state.state === "failure" && state.error !== void 0) return err(state.error);
}
const createQueryRuntime = (options) => {
	if (typeof options.client !== "object" && typeof options.client !== "function" || options.client === null) throw new TypeError("Expected a result-rpc client");
	const clientIdentity = getClientIdentity(options.client);
	if (!clientIdentity) throw new TypeError("Expected a result-rpc client");
	const contractVersion = getClientContractVersion(clientIdentity);
	if (!contractVersion) throw new TypeError("Result-rpc client has no registered contract version");
	wireOnlineManager();
	const queryClient = new QueryClient({ defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
			structuralSharing: (oldData, newData) => shareStructural(oldData, newData)
		},
		mutations: { networkMode: "always" }
	} });
	queryClient.mount();
	const metadataFor = (procedure) => {
		const metadata = getProcedureClientMetadata(procedure);
		if (!metadata || metadata.clientIdentity !== clientIdentity) throw new TypeError("Procedure client belongs to a different result-rpc client");
		return metadata;
	};
	const paginationOf = (metadata) => metadata.procedure._def.pagination;
	const queryKey = (procedure, input) => {
		const metadata = metadataFor(procedure);
		if (metadata.procedure._def.kind !== "query") throw new TypeError(`${metadata.path} is not a query procedure`);
		if (paginationOf(metadata)) {
			const encoded = encodeProcedureInput(metadata.procedure._def.input, {
				list: input,
				cursor: null
			});
			if (!encoded.ok) throw new TypeError(`Invalid query input for ${metadata.path}`);
			if (encoded.value === null || typeof encoded.value !== "object" || !("list" in encoded.value)) throw new TypeError(`Invalid paginated input shape for ${metadata.path}`);
			const listPart = encoded.value.list;
			const serialized = serialize(listPart, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
			if (!serialized.ok) throw new TypeError(`Query input for ${metadata.path} is not serializable`);
			return [metadata.path, serialized.value];
		}
		const encoded = encodeProcedureInput(metadata.procedure._def.input, input);
		if (!encoded.ok) throw new TypeError(`Invalid query input for ${metadata.path}`);
		const serialized = serialize(encoded.value, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
		if (!serialized.ok) throw new TypeError(`Query input for ${metadata.path} is not serializable`);
		return [metadata.path, serialized.value];
	};
	const entityToQueries = /* @__PURE__ */ new Map();
	const queryToEntities = /* @__PURE__ */ new Map();
	const queryKeyByHash = /* @__PURE__ */ new Map();
	const dropQueryFromIndex = (hash) => {
		const previous = queryToEntities.get(hash);
		if (previous) for (const key of previous) {
			const hashes = entityToQueries.get(key);
			hashes?.delete(hash);
			if (hashes && hashes.size === 0) entityToQueries.delete(key);
		}
		queryToEntities.delete(hash);
		queryKeyByHash.delete(hash);
	};
	const reindexQuery = (query) => {
		dropQueryFromIndex(query.queryHash);
		if (query.state.status !== "success" || query.state.data === void 0) return;
		const keys = /* @__PURE__ */ new Set();
		for (const entity of collectEntities(query.state.data)) keys.add(entityKey(entity.model.name, entity.id));
		if (keys.size === 0) return;
		queryToEntities.set(query.queryHash, keys);
		queryKeyByHash.set(query.queryHash, query.queryKey);
		for (const key of keys) {
			const hashes = entityToQueries.get(key) ?? /* @__PURE__ */ new Set();
			hashes.add(query.queryHash);
			entityToQueries.set(key, hashes);
		}
	};
	let suppressReindex = 0;
	/**
	* Queries holding a confirmed entity write that no authoritative fetch has
	* reconciled yet. `dataUpdatedAt` cannot carry this: a patch deliberately
	* leaves it alone so staleness is not laundered, which also means a patched
	* query looks older than it is to anything comparing timestamps — hydration
	* above all.
	*/
	const unreconciledLocalWrites = /* @__PURE__ */ new Set();
	queryClient.getQueryCache().subscribe((event) => {
		if (event.type === "added") reindexQuery(event.query);
		else if (event.type === "updated") {
			if (suppressReindex > 0) return;
			if (("action" in event ? event.action : void 0)?.type === "success") {
				unreconciledLocalWrites.delete(event.query.queryHash);
				reindexQuery(event.query);
			}
		} else if (event.type === "removed") dropQueryFromIndex(event.query.queryHash);
	});
	const queriesContaining = (model, id) => [...entityToQueries.get(entityKey(model.name, id)) ?? []];
	/**
	* Write-through: replace the entity wherever it appears, by the projection
	* rule. Falls back to nothing when the merge changes nothing — a patch that
	* cannot apply is simply not a patch.
	*/
	const patchOneQuery = (queryKey, model, id, produce) => {
		const previous = queryClient.getQueryData(queryKey);
		if (previous === void 0) return false;
		const { value, changed } = patchEntity(previous, model, id, produce);
		if (!changed) return false;
		const query = queryClient.getQueryCache().find({
			queryKey,
			exact: true
		});
		const updatedAt = query?.state.dataUpdatedAt;
		const wasInvalidated = query?.state.isInvalidated ?? false;
		suppressReindex += 1;
		try {
			queryClient.setQueryData(queryKey, value, updatedAt === void 0 ? void 0 : { updatedAt });
		} finally {
			suppressReindex -= 1;
		}
		if (query) unreconciledLocalWrites.add(query.queryHash);
		if (wasInvalidated) query?.invalidate();
		return true;
	};
	const patchQueriesWith = (model, id, produce) => {
		const restores = [];
		for (const hash of queriesContaining(model, id)) {
			const queryKey = queryKeyByHash.get(hash);
			if (!queryKey) continue;
			const previous = queryClient.getQueryData(queryKey);
			if (previous === void 0) continue;
			const captured = collectEntities(previous).find((entity) => entity.model === model && entity.id === id)?.value;
			const wasFetching = queryClient.getQueryCache().get(hash)?.state.fetchStatus === "fetching";
			const applied = patchOneQuery(queryKey, model, id, produce);
			if (wasFetching) queryClient.cancelQueries({
				queryKey,
				exact: true
			}).then(() => {
				patchOneQuery(queryKey, model, id, produce);
				return queryClient.invalidateQueries({
					queryKey,
					exact: true
				});
			});
			if (!applied || !captured) continue;
			restores.push(() => {
				patchOneQuery(queryKey, model, id, (current) => mergeByExistingKeys(current, captured));
			});
		}
		return restores;
	};
	/** Invalidate every query containing any of the entity keys (`model:id`). */
	const invalidateEntityKeys = (keys) => Promise.all(keys.flatMap((key) => [...entityToQueries.get(key) ?? []].map((hash) => {
		const queryKey = queryKeyByHash.get(hash);
		return queryKey ? queryClient.invalidateQueries({
			queryKey,
			exact: true
		}) : Promise.resolve();
	}))).then(() => void 0);
	/**
	* Per-entity write ordering. Responses carry no versions, so arrival order
	* is the only order the network gives us — and a slow response from an
	* older write must not patch stale fields over a newer confirmed write
	* (two optimistic mutations on one entity is the classic shape). Each
	* authoritative write records a start-ordered sequence per entity; a
	* response arriving out of order does NOT patch backwards — it invalidates
	* the entity instead, and the refetch converges on the server.
	*/
	let writeSeq = 0;
	const nextWriteSeq = () => ++writeSeq;
	const entityWriteSeq = /* @__PURE__ */ new Map();
	/** Mutation output entities drive write-through patches by identity. */
	const applyEntityWrites = (output, seq) => {
		for (const entity of collectEntities(output)) {
			const key = entityKey(entity.model.name, entity.id);
			if (seq !== void 0) {
				const last = entityWriteSeq.get(key);
				if (last !== void 0 && last > seq) {
					invalidateEntityKeys([key]);
					continue;
				}
				entityWriteSeq.set(key, seq);
			}
			patchQueriesWith(entity.model, entity.id, (current) => mergeByExistingKeys(current, entity.value));
		}
	};
	/**
	* Resolves an `.affects()` target — a contract entry or procedure object —
	* to this client's procedure function, by identity against the router the
	* client was built from (implemented procedures share their contract's
	* codec references, so contract-declared targets resolve on router clients
	* too).
	*/
	const resolveAffectsTarget = (target) => {
		const router = getClientRouter(clientIdentity);
		if (!router) return void 0;
		for (const [path, procedure] of router.procedures) {
			if (!(Object.is(procedure, target) || procedure._def === target._def || procedure._def.kind === "query" && procedure._def.input === target._def.input && procedure._def.output === target._def.output)) continue;
			let node = options.client;
			for (const segment of path.split(".")) {
				if (node === null || typeof node !== "object" && typeof node !== "function") return;
				node = Reflect.get(node, segment);
			}
			if (typeof node !== "function") return void 0;
			const resolvedMetadata = getProcedureClientMetadata(node);
			if (!resolvedMetadata || resolvedMetadata.clientIdentity !== clientIdentity || resolvedMetadata.path !== path || resolvedMetadata.procedure._def.kind !== "query") return;
			return node;
		}
	};
	const cache = {
		key: queryKey,
		get: (procedure, input) => queryClient.getQueryData(queryKey(procedure, input)),
		update: (procedure, input, updater) => {
			const key = queryKey(procedure, input);
			const previous = queryClient.getQueryData(key);
			queryClient.setQueryData(key, updater);
			return () => queryClient.setQueryData(key, previous);
		},
		invalidate: async (procedure, input) => {
			await queryClient.invalidateQueries({
				queryKey: queryKey(procedure, input),
				exact: true
			});
		},
		invalidateAll: async (procedure) => {
			const metadata = metadataFor(procedure);
			await queryClient.invalidateQueries({ queryKey: [metadata.path] });
		},
		invalidateEntity: (model, id) => {
			const resolved = entityIdFor(model, id);
			if (resolved === void 0) throw new TypeError(`Entity key for ${model.name} is missing key fields`);
			return invalidateEntityKeys([entityKey(model.name, resolved)]);
		},
		updateEntity: (model, id, updater) => {
			const resolved = entityIdFor(model, id);
			if (resolved === void 0) throw new TypeError(`Entity key for ${model.name} is missing key fields`);
			const restores = patchQueriesWith(model, resolved, (current) => {
				const fresh = updater(current);
				if (!isEntityRecord(fresh)) throw new TypeError(`Entity updater for ${model.name} must return an object`);
				return mergeByExistingKeys(current, fresh);
			});
			return () => {
				for (const restore of restores) restore();
			};
		}
	};
	const runtime = {
		client: options.client,
		cache,
		observe: (procedure, input, queryOptions = {}) => {
			const metadata = metadataFor(procedure);
			if (metadata.procedure._def.kind !== "query") throw new TypeError(`${metadata.path} is not a query procedure`);
			if (paginationOf(metadata)) throw new TypeError(`${metadata.path} is paginated; observe it with observePaginated (useResultPaginatedQuery)`);
			if (!encodeProcedureInput(metadata.procedure._def.input, input).ok) throw new TypeError(`Invalid query input for ${metadata.path}`);
			const definitions = metadata.procedure._def.definitions;
			const key = queryKey(procedure, input);
			const hydratedState = queryClient.getQueryState(key);
			if (hydratedState?.status === "success") {
				const decoded = metadata.procedure._def.output.decode(hydratedState.data);
				if (!decoded.ok) queryClient.removeQueries({
					queryKey: key,
					exact: true
				});
				else {
					queryClient.setQueryData(key, decoded.value, { updatedAt: hydratedState.dataUpdatedAt });
					if (hydratedState.isInvalidated) queryClient.getQueryCache().find({
						queryKey: key,
						exact: true
					})?.invalidate();
				}
			}
			const retry = (failureCount, failure) => {
				const configured = queryOptions.retry;
				if (configured === void 0) return defaultShouldRetry(definitions, failureCount, failure);
				if (typeof configured === "function") return metadata.errors.is(failure) && configured(failure, failureCount);
				return configured !== false && failureCount < configured;
			};
			const observerOptions = {
				queryKey: key,
				queryFn: async ({ signal }) => {
					try {
						const result = await invokeProcedureClient(procedure, input, { signal });
						if (!result.isOk()) throw result.error;
						return result.value;
					} catch (failure) {
						if (isCancelled(failure)) throw new CancelledError({ revert: true });
						throw failure;
					}
				},
				...queryOptions.enabled === void 0 ? {} : { enabled: queryOptions.enabled },
				...queryOptions.staleTime === void 0 ? {} : { staleTime: queryOptions.staleTime },
				...queryOptions.gcTime === void 0 ? {} : { gcTime: queryOptions.gcTime },
				retry,
				retryDelay: (failureCount, failure) => defaultRetryDelay(definitions, failureCount, failure)
			};
			const observer = new QueryObserver(queryClient, observerOptions);
			let cached;
			const refetchState = async () => {
				const observed = await observer.refetch();
				cached = project(observed, refetch);
				return cached;
			};
			const refetch = async () => {
				await refetchState();
			};
			cached = project(observer.getCurrentResult(), refetch);
			return {
				key,
				getCurrentState: () => cached,
				subscribe: (listener) => observer.subscribe((observed) => {
					cached = project(observed, refetch);
					listener();
				}),
				refetch: refetchState,
				destroy: () => observer.destroy()
			};
		},
		prefetch: async (procedure, input, prefetchOptions) => {
			const observer = runtime.observe(procedure, input, prefetchOptions);
			try {
				const state = await observer.refetch();
				if (state.state === "pending") throw new TypeError("Prefetch did not settle");
				return state.state === "success" ? ok(state.value) : err(state.error);
			} finally {
				observer.destroy();
			}
		},
		observePaginated: (procedure, input, queryOptions = {}) => {
			const metadata = metadataFor(procedure);
			const pagination = paginationOf(metadata);
			if (metadata.procedure._def.kind !== "query" || !pagination) throw new TypeError(`${metadata.path} is not a paginated query procedure`);
			const definitions = metadata.procedure._def.definitions;
			const key = queryKey(procedure, input);
			const hydratedState = queryClient.getQueryState(key);
			if (hydratedState?.status === "success") {
				const normalized = normalizeInfiniteData(hydratedState.data, (value) => decodePaginatedPage(metadata.procedure, value));
				if (!normalized) queryClient.removeQueries({
					queryKey: key,
					exact: true
				});
				else {
					queryClient.setQueryData(key, normalized, { updatedAt: hydratedState.dataUpdatedAt });
					if (hydratedState.isInvalidated) queryClient.getQueryCache().find({
						queryKey: key,
						exact: true
					})?.invalidate();
				}
			}
			const retry = (failureCount, failure) => {
				const configured = queryOptions.retry;
				if (configured === void 0) return defaultShouldRetry(definitions, failureCount, failure);
				if (typeof configured === "function") return metadata.errors.is(failure) && configured(failure, failureCount);
				return configured !== false && failureCount < configured;
			};
			const observer = new InfiniteQueryObserver(queryClient, {
				queryKey: key,
				queryFn: async ({ signal, pageParam }) => {
					try {
						const cursor = normalizePaginatedCursor(metadata.procedure, pagination, pageParam);
						if (!cursor.ok) throw new TypeError(`Invalid pagination cursor for ${metadata.path}`);
						const result = await invokePaginatedClient(procedure, input, cursor.value, { signal });
						if (!result.isOk()) throw result.error;
						return result.value;
					} catch (failure) {
						if (isCancelled(failure)) throw new CancelledError({ revert: true });
						throw failure;
					}
				},
				initialPageParam: null,
				getNextPageParam: (lastPage) => lastPage.nextCursor,
				...queryOptions.enabled === void 0 ? {} : { enabled: queryOptions.enabled },
				...queryOptions.staleTime === void 0 ? {} : { staleTime: queryOptions.staleTime },
				...queryOptions.gcTime === void 0 ? {} : { gcTime: queryOptions.gcTime },
				retry,
				retryDelay: (failureCount, failure) => defaultRetryDelay(definitions, failureCount, failure)
			});
			let cached;
			const refetchState = async () => {
				await observer.refetch();
				cached = projectPaginated(observer.getCurrentResult());
				return cached;
			};
			const refetch = async () => {
				await refetchState();
			};
			const fetchNextState = async () => {
				const current = observer.getCurrentResult();
				if (!current.hasNextPage || current.isFetchingNextPage) return cached;
				const observed = await observer.fetchNextPage();
				cached = projectPaginated(observed);
				return cached;
			};
			const fetchNext = async () => {
				await fetchNextState();
			};
			const projectPaginated = (observed) => {
				const rows = flattenPages(observed.data);
				const controls = {
					fetch: observed.fetchStatus,
					failureCount: observed.failureCount,
					isStale: observed.isStale,
					updatedAt: observed.dataUpdatedAt,
					pageCount: observed.data?.pages.length ?? 0,
					hasNext: observed.hasNextPage,
					fetchingNext: observed.isFetchingNextPage,
					refetch,
					fetchNext
				};
				if (observed.status === "pending") return {
					...controls,
					state: "pending"
				};
				if (observed.status === "success") return {
					...controls,
					state: "success",
					rows: rows ?? []
				};
				if (!isTaggedError(observed.error)) throw new TypeError("Query engine received an untagged failure");
				return {
					...controls,
					state: "failure",
					error: observed.error,
					...rows === void 0 ? {} : { previous: rows }
				};
			};
			cached = projectPaginated(observer.getCurrentResult());
			return {
				key,
				getCurrentState: () => cached,
				subscribe: (listener) => observer.subscribe((observed) => {
					cached = projectPaginated(observed);
					listener();
				}),
				refetch: refetchState,
				fetchNext: fetchNextState,
				destroy: () => observer.destroy()
			};
		},
		prefetchPaginated: async (procedure, input, prefetchOptions) => {
			const observer = runtime.observePaginated(procedure, input, prefetchOptions);
			try {
				const state = await observer.refetch();
				if (state.state === "pending") throw new TypeError("Prefetch did not settle");
				return state.state === "success" ? ok(state.rows) : err(state.error);
			} finally {
				observer.destroy();
			}
		},
		mutation: (procedure, mutationOptions = {}) => {
			const metadata = metadataFor(procedure);
			if (metadata.procedure._def.kind !== "mutation") throw new TypeError(`${metadata.path} is not a mutation procedure`);
			const definitions = metadata.procedure._def.definitions;
			const declaredAffects = metadata.procedure._def.affects ?? [];
			const declaredWrites = metadata.procedure._def.writes ?? [];
			let activeController;
			const retry = (failureCount, failure) => {
				if (!metadata.errors.is(failure)) return false;
				return shouldRetryMutation(definitions, mutationOptions.retry, failureCount, failure);
			};
			let lastTouched;
			let lastStartSeq = 0;
			const observer = new MutationObserver(queryClient, {
				mutationKey: [metadata.path],
				mutationFn: async (input) => {
					lastStartSeq = nextWriteSeq();
					const result = await invokeProcedureClient(procedure, input, { signal: activeController.signal });
					lastTouched = getTouchedEntities(result);
					if (!result.isOk()) throw result.error;
					return result.value;
				},
				retry,
				retryDelay: (failureCount, failure) => defaultRetryDelay(definitions, failureCount, failure),
				...mutationOptions.optimistic === void 0 ? {} : { onMutate: (input) => mutationOptions.optimistic(input, cache) },
				onSuccess: async (value, input, context) => {
					const written = new Set(collectEntities(value).map((entity) => entityKey(entity.model.name, entity.id)));
					applyEntityWrites(value, lastStartSeq);
					if (lastTouched && lastTouched.length > 0) {
						const cascades = lastTouched.filter((key) => !written.has(key));
						if (cascades.length > 0) invalidateEntityKeys(cascades);
					}
					for (const entry of declaredWrites) cache.invalidateEntity(entry.model, entry.map(input));
					for (const entry of declaredAffects) {
						const target = resolveAffectsTarget(entry.target);
						if (!target) continue;
						if (entry.map) cache.invalidate(target, entry.map(input));
						else cache.invalidateAll(target);
					}
					await mutationOptions.onSuccess?.(value, input);
					await mutationOptions.onSettled?.(ok(value), input, context, cache);
				},
				...mutationOptions.onFailure === void 0 && mutationOptions.onCancel === void 0 && mutationOptions.onSettled === void 0 ? {} : { onError: async (failure, input, context) => {
					if (isCancelled(failure)) return mutationOptions.onCancel?.(input, context, cache);
					if (!metadata.errors.is(failure)) return void 0;
					await mutationOptions.onFailure?.(failure, input, context, cache);
					await mutationOptions.onSettled?.(err(failure), input, context, cache);
				} }
			});
			let cached;
			const mutateAsync = async (input) => {
				activeController?.abort();
				activeController = new AbortController();
				try {
					return ok(await observer.mutate(input));
				} catch (failure) {
					if (isCancelled(failure)) {
						observer.reset();
						throw failure;
					}
					if (!metadata.errors.is(failure)) throw failure;
					return err(failure);
				}
			};
			const cancel = () => activeController?.abort();
			const reset = () => {
				cancel();
				observer.reset();
			};
			const projectMutation = (observed) => {
				const controls = {
					...observed.variables === void 0 ? {} : { variables: observed.variables },
					mutate: (input) => void mutateAsync(input),
					mutateAsync,
					cancel,
					reset
				};
				switch (observed.status) {
					case "idle": return {
						...controls,
						state: "idle"
					};
					case "pending": return {
						...controls,
						state: "pending",
						variables: observed.variables
					};
					case "success": return {
						...controls,
						state: "success",
						value: observed.data,
						variables: observed.variables
					};
					case "error":
						if (isCancelled(observed.error)) return {
							...controls,
							state: "idle"
						};
						if (!metadata.errors.is(observed.error)) return {
							...controls,
							state: "idle"
						};
						return {
							...controls,
							state: "failure",
							error: observed.error,
							variables: observed.variables
						};
				}
			};
			cached = projectMutation(observer.getCurrentResult());
			return {
				getCurrentState: () => cached,
				subscribe: (listener) => observer.subscribe((observed) => {
					cached = projectMutation(observed);
					listener();
				}),
				mutate: (input) => void mutateAsync(input),
				mutateAsync,
				cancel,
				reset,
				destroy: reset
			};
		},
		subscription: (procedure, input, subscriptionOptions = {}) => {
			const metadata = metadataFor(procedure);
			if (!metadata || metadata.procedure._def.kind !== "subscription") throw new TypeError("Expected a result-rpc subscription procedure client");
			const definitions = metadata.procedure._def.definitions;
			const eventIdOf = metadata.procedure._def.resumable?.eventId;
			let lastEventId;
			const listeners = /* @__PURE__ */ new Set();
			let currentStream;
			let generation = 0;
			let retryTimer;
			let removeOnlineListener;
			let state;
			const notify = () => listeners.forEach((listener) => listener());
			const close = () => {
				generation += 1;
				if (retryTimer !== void 0) clearTimeout(retryTimer);
				retryTimer = void 0;
				removeOnlineListener?.();
				removeOnlineListener = void 0;
				currentStream?.close();
				currentStream = void 0;
				state = {
					...state,
					connection: "closed"
				};
				notify();
			};
			const connect = (reset = true, failureCount = 0) => {
				generation += 1;
				if (retryTimer !== void 0) clearTimeout(retryTimer);
				retryTimer = void 0;
				removeOnlineListener?.();
				removeOnlineListener = void 0;
				const activeGeneration = generation;
				if (reset) lastEventId = void 0;
				currentStream?.close();
				currentStream = void 0;
				state = {
					connection: getOnlineSnapshot() ? "connecting" : "paused",
					result: reset ? void 0 : state.result,
					eventCount: reset ? 0 : state.eventCount,
					reconnect: connect,
					close
				};
				notify();
				if (!getOnlineSnapshot()) {
					const unsubscribe = subscribeConnectivity((event) => {
						if (event !== "online") return;
						unsubscribe();
						removeOnlineListener = void 0;
						connect(false, failureCount);
					});
					removeOnlineListener = unsubscribe;
					return;
				}
				currentStream = invokeSubscriptionClient(procedure, input, lastEventId);
				(async () => {
					try {
						for await (const result of currentStream) {
							if (generation !== activeGeneration) return;
							if (!result.isOk()) {
								if (result.error._tag === "client/offline") {
									state = {
										...state,
										connection: "paused"
									};
									notify();
									const unsubscribe = subscribeConnectivity((event) => {
										if (event !== "online") return;
										unsubscribe();
										removeOnlineListener = void 0;
										connect(false, failureCount);
									});
									removeOnlineListener = unsubscribe;
									return;
								}
								const configured = subscriptionOptions.retry;
								if (configured === void 0 ? defaultShouldRetry(definitions, failureCount, result.error) : typeof configured === "function" ? configured(result.error, failureCount) : configured !== false && failureCount < configured) {
									state = {
										...state,
										connection: "reconnecting"
									};
									notify();
									const delay = typeof subscriptionOptions.retryDelayMs === "function" ? subscriptionOptions.retryDelayMs(failureCount + 1) : subscriptionOptions.retryDelayMs ?? 1e3;
									retryTimer = setTimeout(() => connect(false, failureCount + 1), Math.max(0, delay));
									return;
								}
							}
							if (result.status === "ok") {
								applyEntityWrites(result.value, nextWriteSeq());
								if (eventIdOf) lastEventId = eventIdOf(result.value);
							}
							state = {
								...state,
								connection: result.status === "ok" ? "open" : "closed",
								result,
								eventCount: state.eventCount + (result.status === "ok" ? 1 : 0)
							};
							notify();
							if (result.status === "error") return;
						}
						if (generation === activeGeneration) {
							state = {
								...state,
								connection: "closed"
							};
							notify();
						}
					} catch (failure) {
						if (!isCancelled(failure)) queueMicrotask(() => {
							throw failure;
						});
					}
				})();
			};
			state = {
				connection: "connecting",
				result: void 0,
				eventCount: 0,
				reconnect: connect,
				close
			};
			return {
				getCurrentState: () => state,
				subscribe: (listener) => {
					const shouldConnect = listeners.size === 0;
					listeners.add(listener);
					if (shouldConnect) connect();
					return () => {
						listeners.delete(listener);
						if (listeners.size === 0) close();
					};
				},
				reconnect: connect,
				close
			};
		},
		dehydrate: () => {
			const dehydrated = dehydrate(queryClient, {
				shouldDehydrateQuery: (query) => query.state.status === "success" || isDehydratableFailure(query.state.error),
				shouldDehydrateMutation: () => false
			});
			const queries = dehydrated.queries.map((query) => isTaggedError(query.state.error) ? {
				...query,
				state: {
					...query.state,
					error: query.state.error.toJSON(),
					fetchFailureReason: null
				}
			} : query);
			const encoded = serialize({
				...dehydrated,
				queries
			}, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
			if (!encoded.ok) throw new TypeError("Query cache is not wire-serializable");
			return {
				v: 1,
				serializer: 1,
				contract: contractVersion,
				payload: encoded.value
			};
		},
		hydrate: (state) => {
			if (state.v !== 1 || state.serializer !== 1) throw new TypeError("Unsupported result-rpc query cache version");
			if (state.contract !== contractVersion) throw new TypeError(`Dehydrated query cache contract ${String(state.contract)} does not match client contract ${contractVersion}`);
			const decoded = deserialize(state.payload, { maxBytes: DEFAULT_MAX_WIRE_BYTES });
			if (!decoded.ok || decoded.value === null || typeof decoded.value !== "object") throw new TypeError("Invalid result-rpc query cache payload");
			const pendingLocalWrites = /* @__PURE__ */ new Map();
			for (const hash of unreconciledLocalWrites) {
				const query = queryClient.getQueryCache().get(hash);
				if (query?.state.status !== "success" || query.state.data === void 0) continue;
				pendingLocalWrites.set(hash, {
					key: query.queryKey,
					data: query.state.data,
					updatedAt: query.state.dataUpdatedAt
				});
			}
			hydrate(queryClient, decoded.value);
			const router = getClientRouter(clientIdentity);
			if (router) for (const query of queryClient.getQueryCache().getAll()) {
				const path = query.queryKey[0];
				const procedure = typeof path === "string" ? router.procedures.get(path) : void 0;
				if (!procedure || procedure._def.kind !== "query") continue;
				if (query.state.status === "error") {
					const encoded = query.state.error;
					if (isTaggedError(encoded) || !isEncodedTaggedError(encoded)) continue;
					const reified = Object.values(procedure._def.definitions).find((candidate) => candidate.tag === encoded._tag)?.decode(encoded);
					if (reified?.ok) query.setState({ error: reified.value });
					else queryClient.removeQueries({
						queryKey: query.queryKey,
						exact: true
					});
					continue;
				}
				if (query.state.status !== "success" || query.state.data === void 0) continue;
				if (procedure._def.pagination) {
					const normalized = normalizeInfiniteData(query.state.data, procedure._def.output.decode);
					if (!normalized) queryClient.removeQueries({
						queryKey: query.queryKey,
						exact: true
					});
					else {
						const wasInvalidated = query.state.isInvalidated;
						queryClient.setQueryData(query.queryKey, normalized, { updatedAt: query.state.dataUpdatedAt });
						if (wasInvalidated) query.invalidate();
					}
					continue;
				}
				const normalized = procedure._def.output.decode(query.state.data);
				if (!normalized.ok) queryClient.removeQueries({
					queryKey: query.queryKey,
					exact: true
				});
				else {
					const wasInvalidated = query.state.isInvalidated;
					queryClient.setQueryData(query.queryKey, normalized.value, { updatedAt: query.state.dataUpdatedAt });
					if (wasInvalidated) query.invalidate();
				}
			}
			for (const [hash, saved] of pendingLocalWrites) {
				const query = queryClient.getQueryCache().get(hash);
				if (!query || query.state.data === saved.data) continue;
				suppressReindex += 1;
				try {
					queryClient.setQueryData(saved.key, saved.data, { updatedAt: saved.updatedAt });
				} finally {
					suppressReindex -= 1;
				}
				unreconciledLocalWrites.add(hash);
				query.invalidate();
			}
		},
		clear: () => {
			queryClient.unmount();
			queryClient.clear();
			entityToQueries.clear();
			queryToEntities.clear();
			queryKeyByHash.clear();
			entityWriteSeq.clear();
		}
	};
	return runtime;
};
//#endregion
export { SERIALIZER_VERSION, createQueryRuntime, toResult };

//# sourceMappingURL=runtime.js.map
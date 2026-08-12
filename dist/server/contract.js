import { err, ok } from "../result.js";
import { encodeProcedureInput, wire } from "../wire.js";
import { isTaggedError } from "../error.js";
import { mergeDefinitionMaps } from "../error-map.js";
import "../procedure-capability.js";
import { procedureDeclaration } from "../procedure-declaration.js";
import { ServerInternal, badRequestFromIssues } from "../framework-errors.js";
import { entityIdFor, entityKey } from "../model.js";
import { closeIterator } from "../iterator.js";
import { procedureResultCodec } from "../procedure-result-codec.js";
import { Err, Ok } from "better-result";
//#region src/server/contract.ts
function booleanOr(left, right) {
	return left || right;
}
/**
* Fallback for executions with no caller lifetime (tests, jobs). Created on
* first use because Workers forbid constructing runtime I/O primitives during
* module initialization.
*/
let detachedSignal;
const neverAborted = () => {
	detachedSignal ??= new AbortController().signal;
	return detachedSignal;
};
const touchedEntityKey = (model, id) => {
	const resolved = entityIdFor(model, id);
	if (resolved === void 0) throw new TypeError(`Entity key for ${model.name} is missing key fields`);
	return entityKey(model.name, resolved);
};
/**
* Adds `headers` to the context for procedures that declared `.headers()`.
* Callers with no response to write to (the direct server caller, tests) get a
* detached `Headers`: the writes are inert, like cache declarations there.
*/
const contextWithHeaders = (context, procedure, options) => procedure._def.writesHeaders !== true ? context : {
	...context !== null && typeof context === "object" ? context : {},
	headers: options.responseHeaders ?? new Headers()
};
/** Dependencies first, then the middleware itself; duplicates removed by reference. */
const flattenMiddleware = (middleware) => {
	const seen = /* @__PURE__ */ new Set();
	const ordered = [];
	const visit = (current) => {
		if (seen.has(current)) return;
		seen.add(current);
		for (const dependency of current.requires) visit(dependency);
		ordered.push(current);
	};
	visit(middleware);
	return ordered;
};
const appendMiddleware = (existing, middleware) => [...existing, ...flattenMiddleware(middleware).filter((candidate) => !existing.includes(candidate))];
const mergeMiddlewareContext = (context, contribution) => {
	if (typeof context !== "object" || context === null) throw new TypeError("Middleware context must be a non-null object");
	if (typeof contribution !== "object" || contribution === null) throw new TypeError("Middleware context contribution must be a non-null object");
	return {
		...context,
		...contribution
	};
};
var MiddlewareBuilder = class MiddlewareBuilder {
	definitions;
	ownDefinitions;
	dependencies;
	declaresHeaders;
	constructor(definitions = {}, ownDefinitions = {}, dependencies = [], declaresHeaders = false) {
		this.definitions = definitions;
		this.ownDefinitions = ownDefinitions;
		this.dependencies = dependencies;
		this.declaresHeaders = declaresHeaders;
	}
	errors(definitions) {
		return new MiddlewareBuilder(mergeDefinitionMaps(this.definitions, definitions), mergeDefinitionMaps(this.ownDefinitions, definitions), this.dependencies, this.declaresHeaders);
	}
	/**
	* Declares that this middleware writes response headers — a rotated session
	* cookie, a rate-limit header. Adds `context.headers` for the handler, and
	* every procedure that `.use()`s it must declare `.headers()` too, exactly
	* as it must pre-declare the middleware's errors.
	*/
	headers() {
		return new MiddlewareBuilder(this.definitions, this.ownDefinitions, this.dependencies, true);
	}
	/**
	* Declares a middleware this one depends on. The handler's input context
	* becomes the dependency's output context, the dependency's errors join this
	* middleware's union, and any `.use()` site pulls the dependency in
	* automatically — deduplicated by reference when several middleware share it.
	*/
	after(dependency) {
		return new MiddlewareBuilder(mergeDefinitionMaps(this.definitions, dependency.definitions), this.ownDefinitions, [...this.dependencies, dependency], booleanOr(this.declaresHeaders, dependency.writesHeaders));
	}
	use(handler) {
		return Object.freeze({
			_kind: "middleware",
			ownDefinitions: this.ownDefinitions,
			definitions: this.definitions,
			handler,
			requires: this.dependencies,
			writesHeaders: this.declaresHeaders
		});
	}
};
var ProcedureBuilder = class ProcedureBuilder {
	declaration;
	middlewares;
	constructor(declaration, middlewares = []) {
		this.declaration = declaration;
		this.middlewares = middlewares;
	}
	/**
	* Declares that this procedure writes response headers — the login mutation
	* setting a session cookie is the canonical case. Adds `context.headers`,
	* a `Headers` you `append()` to; several procedures in one batch each get
	* their `set-cookie` through without overwriting one another.
	*
	* The declaration is the point: it is recorded in the contract, so a
	* transport knows before dispatch that this call's response headers cannot
	* be sent early. Undeclared procedures have no `context.headers` at all,
	* which turns "my cookie silently vanished under a streaming transport"
	* into a type error.
	*/
	headers() {
		return new ProcedureBuilder(this.declaration.headers(), this.middlewares);
	}
	/**
	* Declares that this subscription can resume after an interrupted
	* connection. `eventId` derives a resume token from an event's value; the
	* client remembers the last one it decoded and the handler receives it as
	* `lastEventId` on the next connect, so the stream continues instead of
	* replaying from the top.
	*
	* The token is derived on both sides from the same declared function, so no
	* event id travels on the wire and the procedure's input codec — and the
	* contract digest's view of it — is unchanged.
	*/
	resumable(options) {
		return new ProcedureBuilder(this.declaration.resumable(options), this.middlewares);
	}
	/**
	* Declares the entity this mutation writes when the output doesn't carry
	* it. Invalidation-only: returning the entity instead earns in-place
	* patches everywhere it appears.
	*/
	writes(model, map) {
		return new ProcedureBuilder(this.declaration.writes(model, map), this.middlewares);
	}
	/**
	* Declares that this mutation invalidates a query on success. `map` turns
	* the mutation's input into the target query's input; omit it to invalidate
	* every cached input of that query. Executed automatically by the client
	* cache — call sites need no `onSettled`.
	*/
	affects(target, map) {
		return new ProcedureBuilder(this.declaration.affects(target, map), this.middlewares);
	}
	input(codec) {
		return new ProcedureBuilder(this.declaration.input(codec), this.middlewares);
	}
	output(codec) {
		return new ProcedureBuilder(this.declaration.output(codec), this.middlewares);
	}
	errors(definitions) {
		return new ProcedureBuilder(this.declaration.errors(definitions), this.middlewares);
	}
	use(middleware) {
		const definitions = mergeDefinitionMaps(this.declaration.definitions, middleware.definitions);
		const writesHeaders = booleanOr(this.declaration.writesHeaders, middleware.writesHeaders);
		return new ProcedureBuilder(this.declaration.rebind(definitions, writesHeaders), appendMiddleware(this.middlewares, middleware));
	}
	query(handler) {
		return handler === void 0 ? this.finishContract("query") : this.finish("query", handler);
	}
	mutation(handler) {
		return handler === void 0 ? this.finishContract("mutation") : this.finish("mutation", handler);
	}
	subscription() {
		return this.finishContract("subscription");
	}
	paginate(options, handler) {
		const definition = this.declaration.paginated(options.cursor);
		if (handler === void 0) return Object.freeze({
			_kind: "procedure-contract",
			_def: definition
		});
		return Object.freeze({
			_kind: "procedure",
			_def: Object.freeze({
				...definition,
				middlewares: this.middlewares,
				handler
			})
		});
	}
	finishContract(kind) {
		return Object.freeze({
			_kind: "procedure-contract",
			_def: this.declaration.unary(kind)
		});
	}
	finish(kind, handler) {
		const definition = this.declaration.unary(kind);
		return Object.freeze({
			_kind: "procedure",
			_def: Object.freeze({
				...definition,
				middlewares: this.middlewares,
				handler
			})
		});
	}
};
var ProcedureImplementer = class ProcedureImplementer {
	contract;
	middlewares;
	constructor(contract, middlewares = []) {
		this.contract = contract;
		this.middlewares = middlewares;
	}
	use(middleware) {
		assertDefinitionsAreDeclared(this.contract._def.definitions, middleware.definitions);
		if (middleware.writesHeaders === true && this.contract._def.writesHeaders !== true) throw new TypeError("This middleware writes response headers, so the contract must declare .headers(). The declaration lives on the contract because transports read it before dispatch.");
		return new ProcedureImplementer(this.contract, appendMiddleware(this.middlewares, middleware));
	}
	handler(handler) {
		const definition = this.contract._def;
		assertUnaryProcedureKind(definition.kind);
		const kind = definition.kind;
		return Object.freeze({
			_kind: "procedure",
			_def: Object.freeze({
				...definition,
				kind,
				middlewares: this.middlewares,
				handler
			})
		});
	}
	stream(handler) {
		if (this.contract._def.kind !== "subscription") throw new TypeError("Only a subscription contract can be implemented with stream()");
		return Object.freeze({
			_kind: "subscription-procedure",
			_def: Object.freeze({
				...this.contract._def,
				kind: "subscription",
				middlewares: this.middlewares,
				handler
			})
		});
	}
};
/**
* The router is the error registry: one tag maps to exactly one definition
* across the whole application. This is what makes tags safe as global
* identities — shells claim ambiently by tag alone, so two procedures reusing
* a tag must share the definition (same reference), never redeclare it.
*/
const collectErrorRegistry = (procedures) => {
	const byTag = /* @__PURE__ */ new Map();
	const firstSeen = /* @__PURE__ */ new Map();
	for (const [path, procedure] of procedures) for (const definition of Object.values(procedure._def.definitions)) {
		const existing = byTag.get(definition.tag);
		if (existing && existing !== definition) throw new TypeError(`Error tag ${definition.tag} has conflicting definitions in ${firstSeen.get(definition.tag)} and ${path}; share one definition instead of redeclaring the tag`);
		if (!existing) {
			byTag.set(definition.tag, definition);
			firstSeen.set(definition.tag, path);
		}
	}
	return byTag;
};
const RESERVED_ROUTER_KEYS = /* @__PURE__ */ new Set([
	"_kind",
	"record",
	"procedures",
	"errors",
	"$errors",
	"_rootContext"
]);
const createRouter = (record) => {
	const procedures = /* @__PURE__ */ new Map();
	const isProcedure = (value) => "_kind" in value && (value._kind === "procedure" || value._kind === "subscription-procedure");
	const visit = (node, prefix) => {
		for (const [key, value] of Object.entries(node)) {
			const path = [...prefix, key];
			if (isProcedure(value)) procedures.set(path.join("."), value);
			else visit(value, path);
		}
	};
	visit(record, []);
	for (const key of Object.keys(record)) if (RESERVED_ROUTER_KEYS.has(key)) throw new TypeError(`Router key ${key} collides with a reserved property`);
	const errors = collectErrorRegistry(procedures);
	return Object.freeze({
		_kind: "router",
		record,
		procedures,
		errors
	});
};
const createRouterContract = (record) => {
	const procedures = /* @__PURE__ */ new Map();
	const isProcedureContract = (value) => "_kind" in value && value._kind === "procedure-contract";
	const visit = (node, prefix) => {
		for (const [key, value] of Object.entries(node)) {
			const path = [...prefix, key];
			if (isProcedureContract(value)) procedures.set(path.join("."), value);
			else visit(value, path);
		}
	};
	visit(record, []);
	for (const key of Object.keys(record)) if (RESERVED_ROUTER_KEYS.has(key)) throw new TypeError(`Contract key ${key} collides with a reserved property`);
	const errors = collectErrorRegistry(procedures);
	return Object.freeze({
		...record,
		_kind: "router-contract",
		record,
		procedures,
		errors
	});
};
const factory = () => ({
	procedure: () => new ProcedureBuilder(procedureDeclaration(wire.object({}), {}, false)),
	middleware: () => new MiddlewareBuilder(),
	router: (record) => createRouter(record),
	contract: (record) => createRouterContract(record),
	implement: (contract) => new ProcedureImplementer(contract)
});
const rpc = Object.assign(factory(), { context: () => factory() });
const assertDefinitionsAreDeclared = (declared, contributed) => {
	const declaredByTag = new Map(Object.values(declared).map((definition) => [definition.tag, definition]));
	for (const definition of Object.values(contributed)) if (declaredByTag.get(definition.tag) !== definition) throw new TypeError(`Middleware error ${definition.tag} is not declared by the procedure contract`);
};
const incidentId = () => `inc_${crypto.randomUUID()}`;
/** Malformed input is the client's fault: a 400 with path-only issues, no incident. */
const badInputFailure = (cause) => err(badRequestFromIssues(cause));
const internalFailure = (phase, cause, options) => {
	if (options.signal?.aborted) throw cause;
	const id = incidentId();
	options.onInternalError?.({
		incidentId: id,
		phase,
		cause,
		...options.procedurePath === void 0 ? {} : { procedurePath: options.procedurePath }
	});
	return err(ServerInternal({ incidentId: id }));
};
/**
* Reifies an erased middleware/handler return before another middleware can
* observe it. Malformed shapes, counterfeit Result objects, and untagged error
* channels become defects at the exact boundary that produced them. Only real
* better-result `Ok`/`Err` instances pass: a shape-compatible plain object is
* not a Result and is sanitized like any other malformed return.
*/
const normalizeRuntimeResult = (candidate, phase, options) => {
	if (candidate instanceof Ok) return candidate;
	if (candidate instanceof Err && isTaggedError(candidate.error)) return candidate;
	return internalFailure(phase, candidate, options);
};
const isAsyncIterable = (value) => value !== null && typeof value === "object" && Symbol.asyncIterator in value && typeof value[Symbol.asyncIterator] === "function";
function assertUnaryProcedureKind(kind) {
	if (kind === "subscription") throw new TypeError("A subscription contract must be implemented with stream()");
}
async function executeProcedure(procedure, input, options) {
	let decodedInput;
	try {
		const encodedInput = encodeProcedureInput(procedure._def.input, input);
		if (!encodedInput.ok) return badInputFailure(encodedInput.issues);
		decodedInput = procedure._def.input.decode(encodedInput.value);
		if (!decodedInput.ok) return badInputFailure(decodedInput.issues);
	} catch (cause) {
		return internalFailure("input", cause, options);
	}
	const dispatch = async (index, context) => {
		const middleware = procedure._def.middlewares[index];
		if (middleware) try {
			return normalizeRuntimeResult(await middleware.handler({
				context,
				errors: middleware.ownDefinitions,
				next: ({ context: contribution }) => dispatch(index + 1, mergeMiddlewareContext(context, contribution))
			}), "middleware", options);
		} catch (cause) {
			return internalFailure("middleware", cause, options);
		}
		try {
			const handlerArgs = {
				context,
				input: decodedInput.value,
				errors: procedure._def.definitions,
				touch: (model, id) => options.onTouch?.(touchedEntityKey(model, id)),
				signal: options.signal ?? neverAborted()
			};
			return normalizeRuntimeResult(await procedure._def.handler(handlerArgs), "handler", options);
		} catch (cause) {
			return internalFailure("handler", cause, options);
		}
	};
	const result = await dispatch(0, contextWithHeaders(options.context, procedure, options));
	if (options.signal?.aborted) throw options.signal.reason;
	const codec = procedureResultCodec(procedure._def.output, procedure._def.definitions);
	if (result.status === "error" && ServerInternal.is(result.error)) return err(result.error);
	try {
		if (result.status === "ok") {
			const serialized = await codec.serialize(result);
			if (!serialized.isOk()) return internalFailure("output", serialized.error, options);
			const decoded = await codec.deserialize(serialized.value);
			if (!decoded.isOk()) return internalFailure("output", decoded.error, options);
			return decoded;
		}
		const serialized = await codec.serialize(result);
		if (!serialized.isOk()) return internalFailure("error", serialized.error, options);
		return result;
	} catch (cause) {
		return internalFailure("output", cause, options);
	}
}
async function* executeSubscription(procedure, input, options) {
	let decodedInput;
	try {
		const encodedInput = encodeProcedureInput(procedure._def.input, input);
		if (!encodedInput.ok) {
			yield badInputFailure(encodedInput.issues);
			return;
		}
		decodedInput = procedure._def.input.decode(encodedInput.value);
		if (!decodedInput.ok) {
			yield badInputFailure(decodedInput.issues);
			return;
		}
	} catch (cause) {
		yield internalFailure("input", cause, options);
		return;
	}
	const prepareContext = async (index, context) => {
		const middleware = procedure._def.middlewares[index];
		if (!middleware) return ok(context);
		try {
			return normalizeRuntimeResult(await middleware.handler({
				context,
				errors: middleware.ownDefinitions,
				next: ({ context: contribution }) => prepareContext(index + 1, mergeMiddlewareContext(context, contribution))
			}), "middleware", options);
		} catch (cause) {
			return internalFailure("middleware", cause, options);
		}
	};
	const prepared = await prepareContext(0, contextWithHeaders(options.context, procedure, options));
	if (prepared.status === "error") {
		if (ServerInternal.is(prepared.error)) yield err(prepared.error);
		else {
			const definition = Object.values(procedure._def.definitions).find((candidate) => candidate.tag === prepared.error._tag);
			yield definition?.policy.visibility === "public" && definition.is(prepared.error) ? err(prepared.error) : internalFailure("error", prepared.error, options);
		}
		return;
	}
	let iterable;
	try {
		const handlerArgs = {
			context: prepared.value,
			input: decodedInput.value,
			errors: procedure._def.definitions,
			lastEventId: options.lastEventId,
			touch: (model, id) => options.onTouch?.(touchedEntityKey(model, id)),
			signal: options.signal ?? neverAborted()
		};
		const candidate = await procedure._def.handler(handlerArgs);
		if (!isAsyncIterable(candidate)) {
			yield internalFailure("handler", candidate, options);
			return;
		}
		iterable = candidate;
	} catch (cause) {
		yield internalFailure("handler", cause, options);
		return;
	}
	let inner;
	try {
		inner = iterable[Symbol.asyncIterator]();
	} catch (cause) {
		yield internalFailure("handler", cause, options);
		return;
	}
	const closeInner = () => {
		closeIterator(inner).catch(() => void 0);
	};
	if (options.signal) if (options.signal.aborted) closeInner();
	else options.signal.addEventListener("abort", closeInner, { once: true });
	const codec = procedureResultCodec(procedure._def.output, procedure._def.definitions);
	try {
		while (true) {
			const step = await inner.next();
			if (options.signal?.aborted) return;
			if (step.done) return;
			const result = normalizeRuntimeResult(step.value, "handler", options);
			if (result.status === "error" && ServerInternal.is(result.error)) {
				yield err(result.error);
				return;
			}
			try {
				if (result.status === "ok") {
					const serialized = await codec.serialize(result);
					if (!serialized.isOk()) {
						yield internalFailure("output", serialized.error, options);
						return;
					}
					const decoded = await codec.deserialize(serialized.value);
					if (!decoded.isOk()) {
						yield internalFailure("output", decoded.error, options);
						return;
					}
					yield decoded;
					continue;
				}
				const serialized = await codec.serialize(result);
				if (!serialized.isOk()) {
					yield internalFailure("error", serialized.error, options);
					return;
				}
				yield result;
				return;
			} catch (cause) {
				yield internalFailure("handler", cause, options);
				return;
			}
		}
	} catch (cause) {
		yield internalFailure("handler", cause, options);
	} finally {
		options.signal?.removeEventListener("abort", closeInner);
		closeInner();
	}
}
//#endregion
export { MiddlewareBuilder, ProcedureBuilder, ProcedureImplementer, assertDefinitionsAreDeclared, executeProcedure, executeSubscription, rpc };

//# sourceMappingURL=contract.js.map
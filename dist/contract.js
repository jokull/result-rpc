import { wire } from "./wire.js";
import { procedureDeclaration } from "./procedure-declaration.js";
//#region src/contract.ts
/**
* Builds procedure descriptions only. Handlers, middleware, and executable
* routers belong to `serverRpc` from `result-rpc/server`.
*/
var ContractProcedureBuilder = class ContractProcedureBuilder {
	declaration;
	constructor(declaration) {
		this.declaration = declaration;
	}
	headers() {
		return new ContractProcedureBuilder(this.declaration.headers());
	}
	writes(model, map) {
		return new ContractProcedureBuilder(this.declaration.writes(model, map));
	}
	affects(target, map) {
		return new ContractProcedureBuilder(this.declaration.affects(target, map));
	}
	input(codec) {
		return new ContractProcedureBuilder(this.declaration.input(codec));
	}
	output(codec) {
		return new ContractProcedureBuilder(this.declaration.output(codec));
	}
	errors(definitions) {
		return new ContractProcedureBuilder(this.declaration.errors(definitions));
	}
	query() {
		return this.finish("query");
	}
	mutation() {
		return this.finish("mutation");
	}
	subscription() {
		return this.finish("subscription");
	}
	paginate(options) {
		return Object.freeze({
			_kind: "procedure-contract",
			_def: this.declaration.paginated(options.cursor)
		});
	}
	finish(kind) {
		return Object.freeze({
			_kind: "procedure-contract",
			_def: this.declaration.unary(kind)
		});
	}
};
const RESERVED_CONTRACT_KEYS = /* @__PURE__ */ new Set([
	"_kind",
	"record",
	"procedures",
	"errors",
	"$errors",
	"_rootContext"
]);
const createContract = (record) => {
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
	for (const key of Object.keys(record)) if (RESERVED_CONTRACT_KEYS.has(key)) throw new TypeError(`Contract key ${key} collides with a reserved property`);
	const errors = collectErrorRegistry(procedures);
	return Object.freeze({
		...record,
		_kind: "router-contract",
		record,
		procedures,
		errors
	});
};
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
const factory = () => ({
	procedure: () => new ContractProcedureBuilder(procedureDeclaration(wire.object({}), {}, false)),
	contract: (record) => createContract(record)
});
const rpc = Object.assign(factory(), { context: () => factory() });
//#endregion
export { ContractProcedureBuilder, rpc };

//# sourceMappingURL=contract.js.map
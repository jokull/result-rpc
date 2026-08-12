import { isTaggedError } from "../error.js";
//#region src/client/base-client.ts
/** Canonical runtime input for an omitted zero-input procedure argument. */
const normalizeClientCallInput = (args) => args.length === 0 ? {} : args[0];
const clientErrorRegistry = (source) => {
	const definitions = /* @__PURE__ */ new Map();
	for (const definition of source) definitions.set(definition.tag, definition);
	return Object.freeze({
		definitions,
		is: (value) => isTaggedError(value) && value.visibility === "public" && definitions.get(value._tag)?.is(value) === true
	});
};
const createClientErrorRegistry = (router, boundaryDefinitions) => clientErrorRegistry([...router.errors.values(), ...boundaryDefinitions]);
/** Runtime counterpart of one generated callable's exact error union. */
const createProcedureClientErrorRegistry = (procedure, boundaryDefinitions) => clientErrorRegistry([...Object.values(procedure._def.definitions), ...boundaryDefinitions]);
//#endregion
export { createClientErrorRegistry, createProcedureClientErrorRegistry, normalizeClientCallInput };

//# sourceMappingURL=base-client.js.map
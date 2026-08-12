//#region src/procedure-capability.ts
/**
* A query whose list identity, cursor, and row types are correlated.
*
* The declared field is type-only: it gives conditional types a required
* inference site without adding placeholder data to the runtime manifest.
*/
var PaginatedProcedureCapability = class {
	writesHeaders;
	mode = "paginated";
	constructor(writesHeaders) {
		this.writesHeaders = writesHeaders;
	}
};
const unaryProcedureCapability = (writesHeaders) => Object.freeze({
	mode: "unary",
	writesHeaders
});
//#endregion
export { PaginatedProcedureCapability, unaryProcedureCapability };

//# sourceMappingURL=procedure-capability.js.map
import { mergeDefinitionMaps } from "./error-map.js";
import { paginationCodecs } from "./procedure-codecs.js";
import { PaginatedProcedureCapability, unaryProcedureCapability } from "./procedure-capability.js";
//#region src/procedure-declaration.ts
/**
* The sole input-erasure boundary for cache declarations. Until a procedure
* reaches a terminal, every mapper remains a function of its exact decoded
* input. The terminal compiler erases that input only after binding the mapper
* to the final input codec carried by the same declaration state.
*/
const compileManifestMapper = (map) => (input) => map(input);
const compileAffects = (entries) => entries.map(({ target, map }) => map === void 0 ? { target } : {
	target,
	map: compileManifestMapper(map)
});
const compileWrites = (entries) => entries.map(({ model, map }) => ({
	model,
	map: compileManifestMapper(map)
}));
/**
* Immutable declaration algebra shared by contract-only and executable
* builders. Public builders only project its transitions into their own
* terminal style; codecs, errors, cache declarations, header capability, and
* terminal manifest compilation live here exactly once.
*/
var ProcedureDeclaration = class ProcedureDeclaration {
	inputCodec;
	outputCodec;
	definitions;
	affectsEntries;
	writesEntries;
	writesHeaders;
	resumableEventId;
	constructor(inputCodec, outputCodec, definitions, affectsEntries, writesEntries, writesHeaders, resumableEventId = void 0) {
		this.inputCodec = inputCodec;
		this.outputCodec = outputCodec;
		this.definitions = definitions;
		this.affectsEntries = affectsEntries;
		this.writesEntries = writesEntries;
		this.writesHeaders = writesHeaders;
		this.resumableEventId = resumableEventId;
	}
	input(codec) {
		if (this.affectsEntries.length > 0 || this.writesEntries.length > 0) throw new TypeError("input() must be declared before affects() or writes()");
		return new ProcedureDeclaration(codec, this.outputCodec, this.definitions, [], [], this.writesHeaders, this.resumableEventId);
	}
	output(codec) {
		return new ProcedureDeclaration(this.inputCodec, codec, this.definitions, this.affectsEntries, this.writesEntries, this.writesHeaders, this.resumableEventId);
	}
	errors(definitions) {
		return new ProcedureDeclaration(this.inputCodec, this.outputCodec, mergeDefinitionMaps(this.definitions, definitions), this.affectsEntries, this.writesEntries, this.writesHeaders, this.resumableEventId);
	}
	headers() {
		return new ProcedureDeclaration(this.inputCodec, this.outputCodec, this.definitions, this.affectsEntries, this.writesEntries, true, this.resumableEventId);
	}
	resumable(options) {
		if (!this.outputCodec) throw new TypeError("resumable() must be declared after output(): it maps the event value");
		return new ProcedureDeclaration(this.inputCodec, this.outputCodec, this.definitions, this.affectsEntries, this.writesEntries, this.writesHeaders, options.eventId);
	}
	writes(model, map) {
		return new ProcedureDeclaration(this.inputCodec, this.outputCodec, this.definitions, this.affectsEntries, [...this.writesEntries, {
			model,
			map
		}], this.writesHeaders, this.resumableEventId);
	}
	affects(target, map) {
		if (target._def.kind !== "query") throw new TypeError("affects() targets must be query procedures");
		const entry = map === void 0 ? { target } : {
			target,
			map
		};
		return new ProcedureDeclaration(this.inputCodec, this.outputCodec, this.definitions, [...this.affectsEntries, entry], this.writesEntries, this.writesHeaders, this.resumableEventId);
	}
	rebind(definitions, writesHeaders) {
		return new ProcedureDeclaration(this.inputCodec, this.outputCodec, definitions, this.affectsEntries, this.writesEntries, writesHeaders, this.resumableEventId);
	}
	unary(kind) {
		if (!this.outputCodec) throw new TypeError("A procedure requires an output codec");
		this.assertKindAllowsDeclarations(kind);
		const affects = compileAffects(this.affectsEntries);
		const writes = compileWrites(this.writesEntries);
		return Object.freeze({
			kind,
			input: this.inputCodec,
			output: this.outputCodec,
			definitions: this.definitions,
			capability: unaryProcedureCapability(this.writesHeaders),
			...affects.length === 0 ? {} : { affects },
			...writes.length === 0 ? {} : { writes },
			...this.writesHeaders ? { writesHeaders: true } : {},
			...this.resumableEventId === void 0 ? {} : { resumable: { eventId: this.resumableEventId } }
		});
	}
	paginated(cursor) {
		if (!this.outputCodec) throw new TypeError("paginate() requires an output codec declaring the row shape");
		this.assertKindAllowsDeclarations("query");
		const item = this.outputCodec;
		const codecs = paginationCodecs(this.inputCodec, cursor, item);
		const pagination = Object.freeze({
			cursor,
			item
		});
		return Object.freeze({
			kind: "query",
			input: codecs.input,
			output: codecs.output,
			definitions: this.definitions,
			capability: new PaginatedProcedureCapability(this.writesHeaders),
			pagination,
			...this.writesHeaders ? { writesHeaders: true } : {},
			...this.resumableEventId === void 0 ? {} : { resumable: { eventId: this.resumableEventId } }
		});
	}
	assertKindAllowsDeclarations(kind) {
		if (this.affectsEntries.length > 0 && kind !== "mutation") throw new TypeError("Only mutations declare .affects(); queries are invalidated, not invalidating");
		if (this.writesEntries.length > 0 && kind !== "mutation") throw new TypeError("Only mutations declare .writes()");
		if (this.resumableEventId !== void 0 && kind !== "subscription") throw new TypeError("Only a subscription declares .resumable(): a unary call has no interrupted stream to resume. Use .paginate() for a cursor over an ordered list.");
		if (this.writesHeaders && kind === "subscription") throw new TypeError("A subscription cannot write response headers: its response is already on the wire before the stream — and therefore any middleware or handler — runs. Set the header in the request that opens the stream instead.");
	}
};
const procedureDeclaration = (input, definitions, writesHeaders) => new ProcedureDeclaration(input, void 0, definitions, [], [], writesHeaders);
//#endregion
export { ProcedureDeclaration, procedureDeclaration };

//# sourceMappingURL=procedure-declaration.js.map
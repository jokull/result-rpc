import { wire } from "./wire.js";
//#region src/procedure-codecs.ts
/** Builds the correlated request and response codecs for a paginated procedure. */
const paginationCodecs = (list, cursor, item) => {
	const cursorOrNull = wire.union([cursor, wire.null]);
	return {
		input: wire.object({
			list,
			cursor: cursorOrNull
		}),
		output: wire.object({
			items: wire.array(item),
			nextCursor: cursorOrNull
		})
	};
};
//#endregion
export { paginationCodecs };

//# sourceMappingURL=procedure-codecs.js.map
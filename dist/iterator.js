//#region src/iterator.ts
/** Closes a sync or async iterator through one audited iterator-protocol boundary. */
const closeIterator = async (iterator) => {
	await iterator.return?.(void 0);
};
//#endregion
export { closeIterator };

//# sourceMappingURL=iterator.js.map
//#region src/error-map.ts
const assertDefinitionsCanMerge = (left, right) => {
	const byTag = new Map(Object.values(left).map((definition) => [definition.tag, definition]));
	for (const [key, definition] of Object.entries(right)) {
		const existingAtKey = left[key];
		if (existingAtKey !== void 0 && existingAtKey !== definition) throw new TypeError(`Conflicting definitions for error key ${key}`);
		const existingWithTag = byTag.get(definition.tag);
		if (existingWithTag !== void 0 && existingWithTag !== definition) throw new TypeError(`Conflicting definitions for error tag ${definition.tag}`);
		byTag.set(definition.tag, definition);
	}
};
const mergeDefinitionMaps = (left, right) => {
	assertDefinitionsCanMerge(left, right);
	return {
		...left,
		...right
	};
};
//#endregion
export { assertDefinitionsCanMerge, mergeDefinitionMaps };

//# sourceMappingURL=error-map.js.map
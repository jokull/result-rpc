//#region src/contract-digest.ts
const fnv1a = (text, seed) => {
	let hash = seed;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash >>> 0;
};
const contractDigest = (routerOrContract) => {
	const lines = [...routerOrContract.procedures.entries()].map(([path, procedure]) => {
		const manifest = procedure._def;
		const errors = Object.values(manifest.definitions).map((definition) => `${JSON.stringify(definition.tag)}#${definition.codec.schema}/${definition.policy.httpStatus ?? "-"}/${definition.policy.retry}/${definition.policy.visibility}/${definition.policy.severity ?? "-"}`).sort().join(",");
		const paginated = manifest.pagination === void 0 ? "" : `|paginated:cursor:${manifest.pagination.cursor.schema}:item:${manifest.pagination.item.schema}`;
		const headers = manifest.writesHeaders === true ? "|headers" : "";
		const resumable = manifest.resumable === void 0 ? "" : "|resumable";
		return `${JSON.stringify(path)}|${manifest.kind}${paginated}${headers}${resumable}|in:${manifest.input.schema}|out:${manifest.output.schema}|${errors}`;
	}).sort().join("\n");
	const high = fnv1a(lines, 2166136261);
	const low = fnv1a(lines, 2538058380);
	return `${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`;
};
const effectiveContractVersion = (routerOrContract, configured) => {
	if (configured !== void 0 && configured.length === 0) throw new TypeError("contractVersion must not be empty");
	return configured ?? contractDigest(routerOrContract);
};
//#endregion
export { contractDigest, effectiveContractVersion };

//# sourceMappingURL=contract-digest.js.map
//#region src/service.ts
function defineService(name, options) {
	return Object.freeze({
		$service: true,
		name,
		needs: options.needs ?? Object.freeze({}),
		create: options.create
	});
}
/**
* Resolves a service graph once, dependencies first. Shared dependencies are
* constructed once per resolution and cycles report the offending path.
*/
const resolveServices = async (definitions) => {
	const memo = /* @__PURE__ */ new Map();
	const visited = /* @__PURE__ */ new Set();
	const visiting = /* @__PURE__ */ new Set();
	const validate = (definition, path) => {
		if (visiting.has(definition)) throw new TypeError(`Service dependency cycle: ${[...path, definition.name].join(" -> ")}`);
		if (visited.has(definition)) return;
		visiting.add(definition);
		for (const dependency of Object.values(definition.needs)) validate(dependency, [...path, definition.name]);
		visiting.delete(definition);
		visited.add(definition);
	};
	for (const definition of Object.values(definitions)) validate(definition, []);
	const resolve = (definition) => {
		const cached = memo.get(definition);
		if (cached) return cached;
		const pending = (async () => {
			const needs = {};
			for (const [key, dependency] of Object.entries(definition.needs)) needs[key] = await resolve(dependency);
			return definition.create(needs);
		})();
		memo.set(definition, pending);
		return pending;
	};
	const resolved = {};
	for (const [key, definition] of Object.entries(definitions)) resolved[key] = await resolve(definition);
	return resolved;
};
//#endregion
export { defineService, resolveServices };

//# sourceMappingURL=service.js.map
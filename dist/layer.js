import { err, ok } from "./result.js";
import { wire } from "./wire.js";
import { mergeDefinitionMaps } from "./error-map.js";
//#region src/layer.ts
function layerValue(key, value) {
	return { [key]: value };
}
const implementContextProcedure = (app, contract, key, middleware) => {
	return app.implement(contract).use(middleware).handler(({ context }) => ok(context[key]));
};
const defineLayer = (options) => {
	const layerMiddleware = (app, resolve) => app.middleware().errors(options.errors).use(async ({ context, next }) => {
		const resolved = await resolve({
			context,
			errors: options.errors
		});
		if (!resolved.isOk()) return resolved;
		return next({ context: layerValue(options.key, resolved.value) });
	});
	const layerContract = (app) => app.procedure().input(wire.object({})).output(options.provides).errors(options.errors).query();
	const layerProcedure = (app, middleware) => implementContextProcedure(app, layerContract(app), options.key, middleware);
	const implementLayerContract = (app, contract, middleware) => implementContextProcedure(app, contract, options.key, middleware);
	const layer = {
		$layer: true,
		name: options.name,
		key: options.key,
		provides: options.provides,
		errors: options.errors,
		middleware: layerMiddleware,
		contract: layerContract,
		procedure: layerProcedure,
		implement: implementLayerContract,
		require: (refineOptions) => {
			if (Object.keys(refineOptions.errors).length === 0) throw new TypeError(`Layer ${refineOptions.name} refines ${options.name} but declares no errors; a refinement that cannot fail is the parent layer`);
			const allDefinitions = mergeDefinitionMaps(options.errors, refineOptions.errors);
			const requiredMiddleware = (app, after) => app.middleware().errors(refineOptions.errors).after(after).use(async ({ context, next }) => {
				const resolved = await refineOptions.refine({
					value: context[options.key],
					errors: refineOptions.errors
				});
				if (!resolved.isOk()) return err(resolved.error);
				return next({ context: layerValue(options.key, resolved.value) });
			});
			const requiredContract = (app) => app.procedure().input(wire.object({})).output(refineOptions.provides).errors(allDefinitions).query();
			const requiredProcedure = (app, middleware) => implementContextProcedure(app, requiredContract(app), options.key, middleware);
			const implementRequiredContract = (app, contract, middleware) => implementContextProcedure(app, contract, options.key, middleware);
			const refined = {
				$layer: true,
				name: refineOptions.name,
				key: options.key,
				provides: refineOptions.provides,
				errors: refineOptions.errors,
				middleware: requiredMiddleware,
				contract: requiredContract,
				procedure: requiredProcedure,
				implement: implementRequiredContract
			};
			return Object.freeze(refined);
		}
	};
	return Object.freeze(layer);
};
//#endregion
export { defineLayer };

//# sourceMappingURL=layer.js.map
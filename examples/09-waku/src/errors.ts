/** Domain errors, declared once as namespaced maps. Keys become tags. */
import { defineErrors, wire } from "result-rpc";

export const spotErrors = defineErrors("spot", {
  notFound: { data: wire.object({ spotId: wire.string }), httpStatus: 404 },
  nameTaken: { data: wire.object({ name: wire.string }), httpStatus: 409 },
});

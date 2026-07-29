/** Browser-safe billing contract; observability handlers stay in server.ts. */
import { defineErrors, rpc, wire } from "../../src/index.js";

export const billingErrors = defineErrors("billing", {
  cardDeclined: { data: wire.object({ code: wire.string }), httpStatus: "payment-required" },
  planExpired: { httpStatus: "forbidden", severity: "warning" },
});

export const app = rpc.context<{}>();

export const chargeContract = app
  .procedure()
  .input(wire.object({ card: wire.string }))
  .output(wire.string)
  .errors(billingErrors)
  .mutation();

export const billingContract = app.contract({ charge: chargeContract });

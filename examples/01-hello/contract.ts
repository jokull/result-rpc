/** Browser-safe runtime contract: codecs, errors, and policies; no handlers. */
import { error, rpc, wire } from "../../src/index.js";

export const GreetingNotFound = error({
  tag: "greeting/not-found",
  data: wire.object({ name: wire.string }),
  httpStatus: 404,
});

export const app = rpc.context<{}>();

export const greetContract = app
  .procedure()
  .input(wire.object({ name: wire.string }))
  .output(wire.string)
  .errors({ GreetingNotFound })
  .query();

export const appContract = app.contract({ greet: greetContract });

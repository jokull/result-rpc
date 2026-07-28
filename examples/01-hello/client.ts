/** Browser client: imports the runtime contract, never the implemented router. */
import { createClient, fetchTransport } from "../../src/client/index.js";
import { appContract } from "./contract.js";

export const client = createClient({
  contract: appContract,
  transport: fetchTransport({ url: "/rpc" }),
});

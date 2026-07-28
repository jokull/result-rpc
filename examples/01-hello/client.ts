/** Browser client: imports the runtime contract, never the implemented router. */
import { createBrowserClient, fetchTransport } from "../../src/client/index.js";
import { appContract } from "./contract.js";

export const client = createBrowserClient({
  contract: appContract,
  transport: fetchTransport({ url: "/rpc" }),
});

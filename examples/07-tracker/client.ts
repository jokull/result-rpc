/**
 * Client factory. Tests hand it a fetch that is the server's fetch handler,
 * so every call crosses the real wire format.
 */
import { createBrowserClient, fetchTransport } from "../../src/client/index.js";
import { appContract } from "./contract.js";

export function makeClient(fetchImpl: typeof globalThis.fetch) {
  return createBrowserClient({
    contract: appContract,
    transport: fetchTransport({ url: "https://tracker.test/rpc", fetch: fetchImpl }),
    contractVersion: "07-tracker",
  });
}

export type AppClient = ReturnType<typeof makeClient>;

/**
 * Client factory. Tests hand it a fetch that is the server's fetch handler,
 * so every call crosses the real wire format.
 */
import { createClient, fetchTransport } from "../../src/client/index.js";
import { appContract } from "./contract.js";

export function makeClient(fetchImpl: typeof globalThis.fetch) {
  return createClient({
    contract: appContract,
    transport: fetchTransport({ url: "https://bookings.test/rpc", fetch: fetchImpl }),
    contractVersion: "08-bookings",
  });
}

export type AppClient = ReturnType<typeof makeClient>;

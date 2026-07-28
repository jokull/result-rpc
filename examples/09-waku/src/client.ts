/**
 * The browser client — built from the CONTRACT, never the router. This is
 * the client-boundary rule from the docs: result-rpc ships a real value to
 * the browser, so what you import here decides what bundles.
 */
import { createBrowserClient, fetchTransport } from "result-rpc/client";
import { appContract } from "./contract.js";

export const client = createBrowserClient({
  contract: appContract,
  transport: fetchTransport({ url: "/rpc" }),
  contractVersion: "09-waku",
});

export type AppClient = typeof client;

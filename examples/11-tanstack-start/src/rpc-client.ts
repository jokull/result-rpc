/**
 * The browser client — built from the CONTRACT, never the router. This is
 * the client-boundary rule from the docs: result-rpc ships a real value to
 * the browser, so what you import here decides what bundles.
 *
 * `url` matches the `endpoint` set on `createFetchHandler` in server.ts:
 * Start's file-based server routes live under `/api`, so both ends say
 * `/api/rpc` instead of the library default `/rpc`.
 */
import { createBrowserClient, fetchTransport } from "result-rpc/client";
import { appContract } from "./contract.js";

export const client = createBrowserClient({
  contract: appContract,
  transport: fetchTransport({ url: "/api/rpc" }),
  contractVersion: "11-tanstack-start",
});

export type AppClient = typeof client;

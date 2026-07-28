/**
 * The browser client — built from the CONTRACT, never the router. This is
 * the client-boundary rule from the docs: result-rpc ships a real value to
 * the browser, so what you import here decides what bundles.
 *
 * The transport `url` must match the `endpoint` given to createFetchHandler
 * in src/server.ts. Next mounts route handlers under /api/*, which is NOT
 * result-rpc's default "/rpc" — so both ends are set explicitly.
 */
import { createBrowserClient, fetchTransport } from "result-rpc/client";
import { appContract } from "./contract";

export const client = createBrowserClient({
  contract: appContract,
  transport: fetchTransport({ url: "/api/rpc" }),
  contractVersion: "10-nextjs",
});

export type AppClient = typeof client;

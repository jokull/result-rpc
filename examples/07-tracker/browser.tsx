/**
 * Real-browser entry: the same App the tests mount, served over an actual
 * HTTP wire (`bun run examples/07-tracker/serve.ts`, then open the URL).
 * The client here differs from the test client in exactly one way: the
 * transport uses the page's own fetch against a relative /rpc.
 */
import { createRoot } from "react-dom/client";
import { createClient, fetchTransport } from "../../src/client/index.js";
import { appContract } from "./contract.js";
import { App } from "./app.js";
import type { AppClient } from "./client.js";

const client = createClient({
  contract: appContract,
  transport: fetchTransport({ url: "/rpc" }),
  contractVersion: "07-tracker",
}) as AppClient;

createRoot(document.getElementById("root")!).render(<App client={client} />);

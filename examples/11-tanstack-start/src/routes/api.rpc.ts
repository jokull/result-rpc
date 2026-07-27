/**
 * The RPC endpoint, as a TanStack Start SERVER ROUTE.
 *
 * Start's file-based routes carry an optional `server.handlers` record
 * keyed by HTTP method; each handler is `(ctx) => Response`. result-rpc's
 * `createFetchHandler` is a plain `Request => Promise<Response>`, so the
 * adapter is one line.
 *
 * This file is server-only by construction: `server.handlers` bodies are
 * stripped from the client build, which is why importing ../rpc-server.js
 * (drizzle + better-sqlite3 + the canary) here is safe.
 */
import { createFileRoute } from "@tanstack/react-router";
import { rpcHandler } from "../rpc-server.js";

export const Route = createFileRoute("/api/rpc")({
  server: {
    handlers: {
      POST: ({ request }) => rpcHandler(request),
    },
  },
});

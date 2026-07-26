/**
 * The RPC endpoint, as an App Router route handler.
 *
 * `createFetchHandler` returns a plain `(Request) => Promise<Response>`, which
 * is exactly the App Router's route-handler signature — so the mount is a
 * one-line re-export, no adapter.
 *
 * GOTCHA: the handler matches the request PATHNAME against its `endpoint`
 * option, whose default is "/rpc". Next's convention puts route handlers under
 * `app/api/**`, so this file serves "/api/rpc". Both sides are told:
 * `endpoint: "/api/rpc"` in src/server.ts and `url: "/api/rpc"` on the client's
 * fetchTransport. Leave either at the default and every call 404s.
 */
import { rpcHandler } from "../../../src/server";

export const POST = rpcHandler;

/** Reads sqlite per request; never prerender or cache this route. */
export const dynamic = "force-dynamic";

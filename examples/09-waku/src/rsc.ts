/**
 * SERVER-ONLY: per-request prefetch runtime for RSC pages. The server
 * client executes procedures in-process in PARITY mode — same middleware,
 * same codecs, same envelope as the wire — so what it prefetches is
 * byte-for-byte what the browser client would have fetched.
 */
import { cache } from "react";
// NOT `result-rpc/react`: that entry calls React.createContext at module
// scope, which does not exist under the react-server condition. The query
// runtime itself is react-free, so it ships as its own `result-rpc/query`
// entry for exactly this use.
import { createQueryRuntime } from "result-rpc/query";
import { createServerClient } from "result-rpc/server";
import { createContext, router } from "./server.js";

/** One runtime per request (React's per-request memo), dehydrated once per boundary. */
export const getServerRuntime = cache(() => {
  const serverClient = createServerClient(router, {
    context: createContext(),
  });
  return { runtime: createQueryRuntime({ client: serverClient }), serverClient };
});

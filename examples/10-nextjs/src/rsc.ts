/**
 * SERVER-ONLY: per-request prefetch runtime for RSC pages. The server
 * client executes procedures in-process in PARITY mode — same middleware,
 * same codecs, same envelope as the wire — so what it prefetches is
 * byte-for-byte what the browser client would have fetched.
 */
import "server-only";
import { cache } from "react";
// NOT `result-rpc/react`: that entry is marked "use client", so the
// react-server environment refuses to EVALUATE it — and `createQueryRuntime`
// is a plain function that must actually run here. The runtime is react-free,
// so it ships as its own entry for exactly this use. (Rendering the react
// entry's *components* from a server component is fine — see app/page.tsx.)
import { createQueryRuntime } from "result-rpc/query";
import { createServerClient } from "result-rpc/server";
import { createContext, router } from "./server";

/**
 * One runtime per request. React's `cache()` memoizes per request, so the
 * layout, the page, and any nested server component share one runtime and
 * accumulate prefetches; each boundary dehydrates what has landed so far.
 */
export const getServerRuntime = cache(() => {
  const serverClient = createServerClient(router, {
    context: createContext(),
  });
  return { runtime: createQueryRuntime({ client: serverClient }), serverClient };
});

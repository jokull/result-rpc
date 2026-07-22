import { createClient, type ClientOf } from "../client/client.js";
import { fetchTransport } from "../client/transport.js";
import type { InternalErrorEvent, Router, RouterContext, RouterRecord } from "./contract.js";
import { createFetchHandler } from "./http.js";

export interface CreateServerClientOptions<TRouter extends Router<any, RouterRecord>> {
  readonly mode: "parity";
  readonly context: RouterContext<TRouter>;
  readonly onInternalError?: (event: InternalErrorEvent) => void;
}

export const createServerClient = <TRouter extends Router<any, RouterRecord>>(
  router: TRouter,
  options: CreateServerClientOptions<TRouter>,
): ClientOf<TRouter> => {
  const handler = createFetchHandler({
    router,
    createContext: () => options.context,
    ...(options.onInternalError === undefined
      ? {}
      : { onInternalError: options.onInternalError }),
  });
  const localFetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(new Request(input, init))) as typeof globalThis.fetch;
  return createClient({
    router,
    transport: fetchTransport({
      url: "http://result-rpc.local/rpc",
      fetch: localFetch,
    }),
  });
};

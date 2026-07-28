import { createParityBrowserClient, type BrowserClientOf } from "../client/client.js";
import { fetchTransport } from "../client/transport.js";
import type {
  InternalErrorEvent,
  Router,
  RouterContext,
  RouterRecord,
} from "../server/contract.js";
import { createFetchHandler } from "../server/http.js";

export interface CreateParityClientOptions<TRouter extends Router<any, RouterRecord>> {
  readonly context: RouterContext<TRouter>;
  readonly onInternalError?: (event: InternalErrorEvent) => void;
}

/**
 * A wire-faithful in-process client for tests. Calls still cross the real
 * serializer, protocol envelope, fetch handler, and browser client decoder.
 */
export const createParityClient = <TRouter extends Router<any, RouterRecord>>(
  router: TRouter,
  options: CreateParityClientOptions<TRouter>,
): BrowserClientOf<TRouter> => {
  const handler = createFetchHandler({
    router,
    createContext: () => options.context,
    ...(options.onInternalError === undefined ? {} : { onInternalError: options.onInternalError }),
  });
  const localFetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(new Request(input, init))) as typeof globalThis.fetch;
  return createParityBrowserClient({
    router,
    transport: fetchTransport({
      url: "http://result-rpc.local/rpc",
      fetch: localFetch,
    }),
  });
};

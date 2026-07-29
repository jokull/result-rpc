import {
  createClientRuntime,
  type BrowserClientOf,
  type ClientEventListener,
} from "../client/client.js";
import { fetchTransport, type ClientTransport } from "../client/transport.js";
import type {
  InternalErrorEvent,
  ContractRouterRecord,
  Router,
  RouterContract,
  RouterContext,
  RouterRecord,
} from "../server/contract.js";
import { createFetchHandler } from "../server/http.js";

interface FixtureClientRuntimeOptions {
  readonly transport: ClientTransport;
  readonly onEvent?: ClientEventListener;
  readonly contractVersion?: string;
}

export interface CreateRouterFixtureClientOptions<
  TRouter extends Router<any, RouterRecord>,
> extends FixtureClientRuntimeOptions {
  readonly router: TRouter;
}

export interface CreateContractFixtureClientOptions<
  TContract extends RouterContract<any, ContractRouterRecord>,
> extends FixtureClientRuntimeOptions {
  readonly contract: TContract;
}

/** A manifest-backed client for in-process tests. Never part of the browser entry. */
export function createFixtureClient<TContract extends RouterContract<any, ContractRouterRecord>>(
  options: CreateContractFixtureClientOptions<TContract>,
): BrowserClientOf<TContract>;
export function createFixtureClient<TRouter extends Router<any, RouterRecord>>(
  options: CreateRouterFixtureClientOptions<TRouter>,
): BrowserClientOf<TRouter>;
export function createFixtureClient(
  options:
    | CreateContractFixtureClientOptions<RouterContract<any, ContractRouterRecord>>
    | CreateRouterFixtureClientOptions<Router<any, RouterRecord>>,
): BrowserClientOf<RouterContract<any, ContractRouterRecord> | Router<any, RouterRecord>> {
  return createClientRuntime("contract" in options ? options.contract : options.router, options);
}

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
  return createFixtureClient({
    router,
    transport: fetchTransport({
      url: "http://result-rpc.local/rpc",
      fetch: localFetch,
    }),
  });
};

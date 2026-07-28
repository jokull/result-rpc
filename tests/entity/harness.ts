/**
 * Shared probe harness — mirrors src/query/runtime.test.ts world-building.
 */
import { createClient } from "../../src/client/client.js";
import { fetchTransport } from "../../src/client/transport.js";
import { createFetchHandler } from "../../src/server/index.js";
import type { AnyTaggedError } from "../../src/error.js";
import type { QueryState, ResultQueryObserver } from "../../src/query/runtime.js";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = <T, E extends AnyTaggedError>(
  observer: ResultQueryObserver<T, E>,
  predicate: (state: QueryState<T, E>) => boolean,
): Promise<QueryState<T, E>> =>
  new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for query state"));
    }, 6_000);
    const check = () => {
      const state = observer.getCurrentState();
      if (!predicate(state)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(state);
    };
    unsubscribe = observer.subscribe(check);
    check();
  });

/** Build a client over an in-process fetch handler, with a request counter. */
export const localClient = <TRouter extends Parameters<typeof createFetchHandler>[0]["router"]>(
  router: TRouter,
  createContext: () => unknown,
) => {
  const handler = createFetchHandler({
    router: router as never,
    createContext: createContext as never,
  });
  let requests = 0;
  const client = createClient({
    router: router as never,
    transport: fetchTransport({
      url: "https://probe.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests += 1;
        return handler(new Request(input, init));
      }) as typeof globalThis.fetch,
    }),
  });
  return { client: client as never, requestCount: () => requests };
};

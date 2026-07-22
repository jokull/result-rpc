import type { ClientOf } from "../client/client.js";
import type { InternalErrorEvent, Router, RouterContext, RouterRecord } from "../server/contract.js";
import { createServerClient } from "../server/server-client.js";

export interface CreateTestClientOptions<TRouter extends Router<any, RouterRecord>> {
  readonly context: RouterContext<TRouter>;
  readonly mode?: "parity";
  readonly onInternalError?: (event: InternalErrorEvent) => void;
}

export const createTestClient = <TRouter extends Router<any, RouterRecord>>(
  router: TRouter,
  options: CreateTestClientOptions<TRouter>,
): ClientOf<TRouter> => createServerClient(router, {
  mode: options.mode ?? "parity",
  context: options.context,
  ...(options.onInternalError === undefined
    ? {}
    : { onInternalError: options.onInternalError }),
});

import { batchFetchTransport, createBrowserClient, type ClientEvent } from "result-rpc/client";
import { appContract } from "../shared/contract";
import type { DemoAccess } from "../shared/errors";

export function makeClient(
  workspaceId: string,
  onEvent: (event: ClientEvent) => void,
  getAccess: () => DemoAccess = () => "writer",
) {
  return createBrowserClient({
    contract: appContract,
    transport: batchFetchTransport({
      url: "/api/rpc",
      headers: { "x-demo-workspace": workspaceId },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-demo-access", getAccess());
        return fetch(input, { ...init, headers });
      },
    }),
    contractVersion: "result-rpc-demo-v2",
    onEvent,
  });
}

export type AppClient = ReturnType<typeof makeClient>;

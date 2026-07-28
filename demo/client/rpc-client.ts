import { batchFetchTransport, createBrowserClient, type ClientEvent } from "result-rpc/client";
import { appContract } from "../shared/contract";

export function makeClient(workspaceId: string, onEvent: (event: ClientEvent) => void) {
  return createBrowserClient({
    contract: appContract,
    transport: batchFetchTransport({
      url: "/api/rpc",
      headers: { "x-demo-workspace": workspaceId },
    }),
    contractVersion: "result-rpc-demo-v1",
    onEvent,
  });
}

export type AppClient = ReturnType<typeof makeClient>;

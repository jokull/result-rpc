/**
 * The RPC endpoint. Waku serves `_api/rpc.ts` at `/rpc`, which is exactly
 * result-rpc's default endpoint — the fetch handler checks the pathname
 * itself, so the two conventions line up with zero glue.
 */
import { rpcHandler } from "../../server.js";

export const POST = rpcHandler;

export const getConfig = async () => {
  return { render: "dynamic" } as const;
};

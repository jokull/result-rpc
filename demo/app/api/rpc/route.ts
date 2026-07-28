import { rpcHandler } from "../../../server/rpc-server";

export const POST = (request: Request) => rpcHandler(request);

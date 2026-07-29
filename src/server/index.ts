/**
 * The server runtime. Shared contracts use `rpc` from the package root;
 * middleware, implementations, and executable routers use `serverRpc` here.
 */
export { createFetchHandler } from "./http.js";
export type { ErrorResponseEvent, FetchHandlerOptions } from "./http.js";
export { createServerClient } from "./server-client.js";
export { rpc as serverRpc } from "./contract.js";
export type {
  CreateServerClientOptions,
  ServerCallArgs,
  ServerCallOptions,
  ServerBoundaryError,
  ServerClientErrorOf,
  ServerClientOf,
  ServerClientRecord,
  ServerProcedureClient,
} from "./server-client.js";
export type { ExecutionOptions, InternalErrorEvent, ProcedureHandlerArgs } from "./contract.js";
export type { RpcFactory as ServerRpcFactory } from "./contract.js";

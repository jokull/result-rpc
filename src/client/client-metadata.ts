import type {
  ClientProcedure,
  ClientProcedureSource,
  ClientRouter,
  ProcedureClientTypeCarrier,
} from "./base-client.js";

export interface ProcedureClientMetadata<TProcedure extends ClientProcedure = ClientProcedure> {
  readonly path: string;
  readonly procedure: TProcedure;
  readonly clientIdentity: object;
}

const procedureClientMetadata = new WeakMap<Function, ProcedureClientMetadata>();
const clientIdentities = new WeakMap<object, object>();
const clientRouters = new WeakMap<object, ClientRouter>();
const touchedByResult = new WeakMap<object, readonly string[]>();

export const registerClientIdentity = (
  value: object,
  clientIdentity: object,
  router?: ClientRouter,
): void => {
  clientIdentities.set(value, clientIdentity);
  if (router) clientRouters.set(clientIdentity, router);
};

export const registerProcedureClient = (fn: Function, metadata: ProcedureClientMetadata): void => {
  clientIdentities.set(fn, metadata.clientIdentity);
  procedureClientMetadata.set(fn, metadata);
};

/** Registers a non-browser caller so the query runtime can prefetch through it. */
export const registerClientLike = (
  caller: object,
  router: ClientRouter,
  procedures: ReadonlyMap<string, { readonly fn: Function; readonly procedure: ClientProcedure }>,
): void => {
  const clientIdentity = Object.freeze({});
  registerClientIdentity(caller, clientIdentity, router);
  for (const [path, entry] of procedures) {
    registerProcedureClient(entry.fn, { path, procedure: entry.procedure, clientIdentity });
  }
};

export const getClientRouter = (clientIdentity: object): ClientRouter | undefined =>
  clientRouters.get(clientIdentity);

export function getProcedureClientMetadata<TClient extends Function & ProcedureClientTypeCarrier>(
  value: TClient,
): ProcedureClientMetadata<Extract<ClientProcedureSource<TClient>, ClientProcedure>> | undefined;
export function getProcedureClientMetadata(value: Function): ProcedureClientMetadata | undefined;
export function getProcedureClientMetadata(value: Function): ProcedureClientMetadata | undefined {
  return procedureClientMetadata.get(value);
}

export const getClientIdentity = (value: unknown): object | undefined =>
  (typeof value === "object" && value !== null) || typeof value === "function"
    ? clientIdentities.get(value)
    : undefined;

/** Records the `model:id` keys the server declared touching for one result. */
export const recordTouchedEntities = (result: object, keys: readonly string[]): void => {
  touchedByResult.set(result, keys);
};

export const getTouchedEntities = (result: object): readonly string[] | undefined =>
  touchedByResult.get(result);

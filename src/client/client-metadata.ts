import type { AnyPublicErrorDefinition } from "../error.js";
import { effectiveContractVersion, type EffectiveContractVersion } from "../contract-digest.js";
import type { EntityCacheKey } from "../model.js";
import { createProcedureClientErrorRegistry } from "./base-client.js";
import type {
  AnyProcedureClientTypes,
  ClientErrorRegistry,
  ClientProcedure,
  ClientProcedureTypes,
  ClientRouter,
  ProcedureClientTypeCarrier,
} from "./base-client.js";

export interface ProcedureClientMetadata<
  TTypes extends AnyProcedureClientTypes = AnyProcedureClientTypes,
> {
  readonly path: string;
  readonly procedure: Extract<TTypes["procedure"], ClientProcedure>;
  /** Exact procedure errors plus the canned failures of this client boundary. */
  readonly errors: ClientErrorRegistry<TTypes["error"]>;
  readonly clientIdentity: object;
}

const procedureClientMetadata = new WeakMap<Function, ProcedureClientMetadata>();
const clientIdentities = new WeakMap<object, object>();
interface ClientRuntimeMetadata {
  readonly router: ClientRouter;
  readonly contractVersion: EffectiveContractVersion;
}

const clientRuntimeMetadata = new WeakMap<object, ClientRuntimeMetadata>();
const touchedByResult = new WeakMap<object, readonly EntityCacheKey[]>();

export const registerClientIdentity = (
  value: object,
  clientIdentity: object,
  router?: ClientRouter,
  contractVersion?: EffectiveContractVersion,
): void => {
  clientIdentities.set(value, clientIdentity);
  if (router) {
    clientRuntimeMetadata.set(clientIdentity, {
      router,
      contractVersion: contractVersion ?? effectiveContractVersion(router),
    });
  }
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
  boundaryDefinitions: readonly AnyPublicErrorDefinition[],
  contractVersion?: EffectiveContractVersion,
): void => {
  const clientIdentity = Object.freeze({});
  registerClientIdentity(caller, clientIdentity, router, contractVersion);
  for (const [path, entry] of procedures) {
    registerProcedureClient(entry.fn, {
      path,
      procedure: entry.procedure,
      errors: createProcedureClientErrorRegistry(entry.procedure, boundaryDefinitions),
      clientIdentity,
    });
  }
};

export const getClientRouter = (clientIdentity: object): ClientRouter | undefined =>
  clientRuntimeMetadata.get(clientIdentity)?.router;

export const getClientContractVersion = (
  clientIdentity: object,
): EffectiveContractVersion | undefined =>
  clientRuntimeMetadata.get(clientIdentity)?.contractVersion;

export function getProcedureClientMetadata<TClient extends Function & ProcedureClientTypeCarrier>(
  value: TClient,
): ProcedureClientMetadata<ClientProcedureTypes<TClient>> | undefined;
export function getProcedureClientMetadata(value: Function): ProcedureClientMetadata | undefined;
export function getProcedureClientMetadata(value: Function): ProcedureClientMetadata | undefined {
  return procedureClientMetadata.get(value);
}

export const getClientIdentity = (value: unknown): object | undefined =>
  (typeof value === "object" && value !== null) || typeof value === "function"
    ? clientIdentities.get(value)
    : undefined;

/** Records the `model:id` keys the server declared touching for one result. */
export const recordTouchedEntities = (result: object, keys: readonly EntityCacheKey[]): void => {
  touchedByResult.set(result, keys);
};

export const getTouchedEntities = (result: object): readonly EntityCacheKey[] | undefined =>
  touchedByResult.get(result);

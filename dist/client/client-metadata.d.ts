import type { AnyPublicErrorDefinition } from "../error.js";
import { type EffectiveContractVersion } from "../contract-digest.js";
import type { EntityCacheKey } from "../model.js";
import type { AnyProcedureClientTypes, ClientErrorRegistry, ClientProcedure, ClientProcedureTypes, ClientRouter, ProcedureClientTypeCarrier } from "./base-client.js";
export interface ProcedureClientMetadata<TTypes extends AnyProcedureClientTypes = AnyProcedureClientTypes> {
    readonly path: string;
    readonly procedure: Extract<TTypes["procedure"], ClientProcedure>;
    /** Exact procedure errors plus the canned failures of this client boundary. */
    readonly errors: ClientErrorRegistry<TTypes["error"]>;
    readonly clientIdentity: object;
}
export declare const registerClientIdentity: (value: object, clientIdentity: object, router?: ClientRouter, contractVersion?: EffectiveContractVersion) => void;
export declare const registerProcedureClient: (fn: Function, metadata: ProcedureClientMetadata) => void;
/** Registers a non-browser caller so the query runtime can prefetch through it. */
export declare const registerClientLike: (caller: object, router: ClientRouter, procedures: ReadonlyMap<string, {
    readonly fn: Function;
    readonly procedure: ClientProcedure;
}>, boundaryDefinitions: readonly AnyPublicErrorDefinition[], contractVersion?: EffectiveContractVersion) => void;
export declare const getClientRouter: (clientIdentity: object) => ClientRouter | undefined;
export declare const getClientContractVersion: (clientIdentity: object) => EffectiveContractVersion | undefined;
export declare function getProcedureClientMetadata<TClient extends Function & ProcedureClientTypeCarrier>(value: TClient): ProcedureClientMetadata<ClientProcedureTypes<TClient>> | undefined;
export declare function getProcedureClientMetadata(value: Function): ProcedureClientMetadata | undefined;
export declare const getClientIdentity: (value: unknown) => object | undefined;
/** Records the `model:id` keys the server declared touching for one result. */
export declare const recordTouchedEntities: (result: object, keys: readonly EntityCacheKey[]) => void;
export declare const getTouchedEntities: (result: object) => readonly EntityCacheKey[] | undefined;

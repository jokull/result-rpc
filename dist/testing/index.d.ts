import { type BrowserClientOf, type ClientEventListener } from "../client/client.js";
import { type ClientTransport } from "../client/transport.js";
import type { AnyRouter, AnyRouterContract, InternalErrorEvent, RouterContext } from "../server/contract.js";
import type { EffectiveContractVersion } from "../contract-digest.js";
export type * from "../client/index.js";
export type * from "../server/index.js";
export interface FixtureClientRuntimeOptions {
    readonly transport: ClientTransport;
    readonly onEvent?: ClientEventListener;
    readonly contractVersion?: EffectiveContractVersion;
}
export type { BrowserClientOf } from "../client/client.js";
export type { BrowserBoundaryError, ClientEvent, ClientEventListener } from "../client/client.js";
export type { BaseClientOf, ClientErrorOf, ClientErrorRegistry, ClientRecord, ClientRouterRecordOf, } from "../client/base-client.js";
export type { ClientTransport, TransportOutcome, TransportRequestOptions, TransportStreamOutcome, } from "../client/transport.js";
export type { AnyPublicErrorDefinition, AnyPublicTaggedError } from "../error.js";
export type { ClientBoundaryError } from "../framework-errors.js";
export { ClientDecodeFailure, ClientHttpFailure, ClientNetworkFailure, ClientOffline, ClientProtocolViolation, ClientStale, ClientTimeout, ServerBadRequest, ServerInternal, } from "../framework-errors.js";
export type { RequestEnvelope } from "../protocol.js";
export { PROTOCOL_VERSION } from "../protocol.js";
export type { EffectiveContractVersion } from "../contract-digest.js";
export type { AnyRouter, AnyRouterContract, AnyProcedure, AnyProcedureContract, ContractRouterRecord, InternalErrorEvent, Router, RouterContract, RouterContext, RouterRecord, RouterTypes, RouterTypesOf, } from "../server/contract.js";
export interface CreateRouterFixtureClientOptions<TRouter extends AnyRouter> extends FixtureClientRuntimeOptions {
    readonly router: TRouter;
}
export interface CreateContractFixtureClientOptions<TContract extends AnyRouterContract> extends FixtureClientRuntimeOptions {
    readonly contract: TContract;
}
/** A manifest-backed client for in-process tests. Never part of the browser entry. */
export declare function createFixtureClient<TContract extends AnyRouterContract>(options: CreateContractFixtureClientOptions<TContract>): BrowserClientOf<TContract>;
export declare function createFixtureClient<TRouter extends AnyRouter>(options: CreateRouterFixtureClientOptions<TRouter>): BrowserClientOf<TRouter>;
export interface CreateParityClientOptions<TRouter extends AnyRouter> {
    readonly context: RouterContext<TRouter>;
    readonly onInternalError?: (event: InternalErrorEvent) => void;
    readonly contractVersion?: EffectiveContractVersion;
}
/**
 * A wire-faithful in-process client for tests. Calls still cross the real
 * serializer, protocol envelope, fetch handler, and browser client decoder.
 */
export declare const createParityClient: <TRouter extends AnyRouter>(router: TRouter, options: CreateParityClientOptions<TRouter>) => BrowserClientOf<TRouter>;

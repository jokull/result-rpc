import { type AnyPublicErrorDefinition, type AnyPublicTaggedError, type AnyTaggedError } from "../error.js";
import type { Result } from "../result.js";
import type { EmptyObject } from "../wire.js";
import type { AnyProcedureContract, ProcedureTypesOf } from "../procedure-types.js";
import type { AnyProcedure, AnyRouter, AnyRouterContract, ContractRouterRecord, ErrorUnion, RouterRecordOf, RouterRecord } from "../server/contract.js";
export type ClientProcedure = AnyProcedure | AnyProcedureContract;
export type ClientRouterRecord = RouterRecord | ContractRouterRecord;
export type ClientRouter = AnyRouter | AnyRouterContract;
/** A browser subscription owns transport resources and can be closed explicitly. */
export interface ResultSubscription<T, E extends AnyTaggedError> extends AsyncIterable<Result<T, E>> {
    readonly close: () => void;
}
/** Runtime definitions plus an app-wide type guard for a client's public error union. */
export interface ClientErrorRegistry<E extends AnyTaggedError> {
    readonly definitions: ReadonlyMap<string, AnyPublicErrorDefinition>;
    is(value: unknown): value is E;
}
/** Zero-input procedures may be called with no argument. */
export type ClientCallArgs<TInput, TOptions> = EmptyObject extends TInput ? [input?: TInput, options?: TOptions] : [input: TInput, options?: TOptions];
/** Canonical runtime input for an omitted zero-input procedure argument. */
export declare const normalizeClientCallInput: (args: readonly unknown[]) => unknown;
export type SubscriptionResult<TMode extends "managed" | "iterable", TOutput, TError extends AnyTaggedError> = TMode extends "managed" ? ResultSubscription<TOutput, TError> : AsyncIterable<Result<TOutput, TError>>;
declare const procedureClientTypes: unique symbol;
export interface ClientPaginationTypes<TListInput, TCursor, TItem> {
    readonly mode: "paginated";
    readonly listInput: TListInput;
    readonly cursor: TCursor;
    readonly item: TItem;
}
export interface ClientUnaryTypes {
    readonly mode: "unary";
}
export type ClientProcedureCapability = ClientUnaryTypes | ClientPaginationTypes<unknown, unknown, unknown>;
export type InferClientPagination<TCapability> = TCapability extends {
    readonly mode: "paginated";
    readonly _types: {
        readonly listInput: infer TListInput;
        readonly cursor: infer TCursor;
        readonly item: infer TItem;
    };
} ? ClientPaginationTypes<TListInput, TCursor, TItem> : ClientUnaryTypes;
/**
 * Exact generated-client facts. Input, output, kind, and pagination are
 * projections of one source procedure; they cannot drift independently.
 */
export interface ProcedureClientTypes<TProcedure extends ClientProcedure, TBoundaryError extends AnyPublicTaggedError> {
    readonly input: ProcedureTypesOf<TProcedure>["input"];
    readonly output: ProcedureTypesOf<TProcedure>["output"];
    readonly error: ErrorUnion<ProcedureTypesOf<TProcedure>["definitions"]> | TBoundaryError;
    readonly kind: ProcedureTypesOf<TProcedure>["kind"];
    readonly procedure: TProcedure;
    readonly capability: InferClientPagination<ProcedureTypesOf<TProcedure>["capability"]>;
}
/** Runtime-erased client facts. It carries no callable signature or inference source. */
export interface AnyProcedureClientTypes {
    readonly input: unknown;
    readonly output: unknown;
    readonly error: AnyTaggedError;
    readonly kind: "query" | "mutation" | "subscription";
    readonly procedure: ClientProcedure;
    readonly capability: ClientProcedureCapability;
}
/** Associated types retained by every generated procedure client. */
export interface ProcedureClientTypeCarrier<TTypes extends AnyProcedureClientTypes = AnyProcedureClientTypes> {
    readonly [procedureClientTypes]: TTypes;
}
export type ClientProcedureTypes<TProcedureClient> = TProcedureClient extends ProcedureClientTypeCarrier<infer TTypes> ? TTypes : never;
export type ClientProcedureInput<TProcedureClient> = ClientProcedureTypes<TProcedureClient>["input"];
export type ClientProcedureOutput<TProcedureClient> = ClientProcedureTypes<TProcedureClient>["output"];
export type ClientProcedureError<TProcedureClient> = ClientProcedureTypes<TProcedureClient>["error"];
export type ClientProcedureKind<TProcedureClient> = ClientProcedureTypes<TProcedureClient>["kind"];
export type ClientProcedureSource<TProcedureClient> = ClientProcedureTypes<TProcedureClient>["procedure"];
export type ClientProcedurePagination<TProcedureClient> = ClientProcedureTypes<TProcedureClient>["capability"] extends infer TCapability ? TCapability extends ClientPaginationTypes<unknown, unknown, unknown> ? TCapability : never : never;
/**
 * Projects a contract procedure and one client's reachable boundary failures
 * into the single associated-type record carried by its callable.
 */
export type ProcedureClientTypesFor<TProcedure, TBoundaryError extends AnyPublicTaggedError> = TProcedure extends ClientProcedure ? ProcedureClientTypes<TProcedure, TBoundaryError> : never;
export type ProcedureClientFromTypes<TTypes extends AnyProcedureClientTypes, TOptions, TSubscriptionMode extends "managed" | "iterable"> = TTypes["kind"] extends "subscription" ? ((...args: ClientCallArgs<TTypes["input"], TOptions>) => SubscriptionResult<TSubscriptionMode, TTypes["output"], TTypes["error"]>) & {
    readonly $kind: TTypes["kind"];
} & ProcedureClientTypeCarrier<TTypes> : ((...args: ClientCallArgs<TTypes["input"], TOptions>) => Promise<Result<TTypes["output"], TTypes["error"]>>) & {
    readonly $kind: TTypes["kind"];
} & ProcedureClientTypeCarrier<TTypes>;
/**
 * The shared callable algebra. Environments supply only their reachable
 * boundary errors, call options, and subscription lifetime shape.
 */
export type ProcedureClient<TProcedure, TBoundaryError extends AnyPublicTaggedError, TOptions, TSubscriptionMode extends "managed" | "iterable"> = ProcedureClientFromTypes<ProcedureClientTypesFor<TProcedure, TBoundaryError>, TOptions, TSubscriptionMode>;
export type ClientRecord<TRecord, TBoundaryError extends AnyPublicTaggedError, TOptions, TSubscriptionMode extends "managed" | "iterable"> = {
    readonly [TKey in keyof TRecord]: TRecord[TKey] extends ClientProcedure ? ProcedureClient<TRecord[TKey], TBoundaryError, TOptions, TSubscriptionMode> : TRecord[TKey] extends ClientRouterRecord ? ClientRecord<TRecord[TKey], TBoundaryError, TOptions, TSubscriptionMode> : never;
};
export type ClientRecordError<TRecord> = {
    readonly [TKey in keyof TRecord]: TRecord[TKey] extends ClientProcedure ? ErrorUnion<ProcedureTypesOf<TRecord[TKey]>["definitions"]> : TRecord[TKey] extends ClientRouterRecord ? ClientRecordError<TRecord[TKey]> : never;
}[keyof TRecord];
export type ClientRouterRecordOf<TRouter> = Extract<RouterRecordOf<TRouter>, RouterRecord | ContractRouterRecord>;
/** Every public failure reachable through one concrete client environment. */
export type ClientErrorOf<TRouter, TBoundaryError extends AnyPublicTaggedError> = Extract<ClientRecordError<ClientRouterRecordOf<TRouter>> | TBoundaryError, AnyPublicTaggedError>;
export type BaseClientOf<TRouter, TBoundaryError extends AnyPublicTaggedError, TOptions, TSubscriptionMode extends "managed" | "iterable"> = ClientRecord<ClientRouterRecordOf<TRouter>, TBoundaryError, TOptions, TSubscriptionMode> & {
    readonly $errors: ClientErrorRegistry<ClientErrorOf<TRouter, TBoundaryError>>;
};
/** Extracts the flattened, public error union carried by a client instance. */
export type ClientErrors<TClient> = TClient extends {
    readonly $errors: ClientErrorRegistry<infer E>;
} ? E : never;
export declare const createClientErrorRegistry: <E extends AnyPublicTaggedError>(router: ClientRouter, boundaryDefinitions: readonly AnyPublicErrorDefinition[]) => ClientErrorRegistry<E>;
/** Runtime counterpart of one generated callable's exact error union. */
export declare const createProcedureClientErrorRegistry: <E extends AnyTaggedError>(procedure: ClientProcedure, boundaryDefinitions: readonly AnyPublicErrorDefinition[]) => ClientErrorRegistry<E>;
export {};

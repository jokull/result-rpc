import {
  isTaggedError,
  type AnyPublicErrorDefinition,
  type AnyPublicTaggedError,
  type AnyTaggedError,
} from "../error.js";
import type { Result } from "../result.js";
import type { EmptyObject, WireCodec, WireValue } from "../wire.js";
import type {
  AnyProcedure,
  AnyProcedureContract,
  ContractRouterRecord,
  ErrorDefinitionMap,
  ErrorUnion,
  Router,
  RouterContract,
  RouterRecord,
} from "../server/contract.js";

export type ClientProcedure = AnyProcedure | AnyProcedureContract;
export type ClientRouterRecord = RouterRecord | ContractRouterRecord;
export type ClientRouter = Router<any, RouterRecord> | RouterContract<any, ContractRouterRecord>;

/** A browser subscription owns transport resources and can be closed explicitly. */
export interface ResultSubscription<T, E extends AnyTaggedError> extends AsyncIterable<
  Result<T, E>
> {
  readonly close: () => void;
}

/** Runtime definitions plus an app-wide type guard for a client's public error union. */
export interface ClientErrorRegistry<E extends AnyPublicTaggedError> {
  readonly definitions: ReadonlyMap<string, AnyPublicErrorDefinition>;
  is(value: unknown): value is E;
}

/** Zero-input procedures may be called with no argument. */
export type ClientCallArgs<TInput, TOptions> = EmptyObject extends TInput
  ? [input?: TInput, options?: TOptions]
  : [input: TInput, options?: TOptions];

type SubscriptionResult<
  TMode extends "managed" | "iterable",
  TOutput,
  TError extends AnyTaggedError,
> = TMode extends "managed"
  ? ResultSubscription<TOutput, TError>
  : AsyncIterable<Result<TOutput, TError>>;

declare const procedureClientTypes: unique symbol;

export interface ClientPaginationTypes<TListInput, TCursor, TItem> {
  readonly listInput: TListInput;
  readonly cursor: TCursor;
  readonly item: TItem;
}

type InferClientPagination<TCapability> = TCapability extends {
  readonly mode: "paginated";
  readonly _types: {
    readonly listInput: infer TListInput;
    readonly cursor: infer TCursor;
    readonly item: infer TItem;
  };
}
  ? ClientPaginationTypes<TListInput, TCursor, TItem>
  : never;

/** The associated types of one generated procedure client. */
export interface ProcedureClientTypes<
  TInput = unknown,
  TOutput = unknown,
  TError extends AnyTaggedError = AnyTaggedError,
  TKind extends "query" | "mutation" | "subscription" = "query" | "mutation" | "subscription",
  TProcedure extends ClientProcedure = ClientProcedure,
  TPagination = never,
  TPaginationMode extends "unary" | "paginated" = [TPagination] extends [never]
    ? "unary"
    : "paginated",
> {
  readonly input: TInput;
  readonly output: TOutput;
  readonly error: TError;
  readonly kind: TKind;
  readonly procedure: TProcedure;
  readonly pagination: TPagination;
  readonly paginationMode: TPaginationMode;
}

// `any` is intentional at this existential boundary: consumers recover the
// concrete associated record through `ClientProcedureTypes<T>` before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyProcedureClientTypes = ProcedureClientTypes<
  any,
  any,
  AnyTaggedError,
  any,
  any,
  any,
  any
>;

/** Associated types retained by every generated procedure client. */
export interface ProcedureClientTypeCarrier<
  TTypes extends AnyProcedureClientTypes = AnyProcedureClientTypes,
> {
  readonly [procedureClientTypes]: TTypes;
}

export type ClientProcedureTypes<TProcedureClient> =
  TProcedureClient extends ProcedureClientTypeCarrier<infer TTypes> ? TTypes : never;

export type ClientProcedureInput<TProcedureClient> =
  ClientProcedureTypes<TProcedureClient>["input"];

export type ClientProcedureOutput<TProcedureClient> =
  ClientProcedureTypes<TProcedureClient>["output"];

export type ClientProcedureError<TProcedureClient> =
  ClientProcedureTypes<TProcedureClient>["error"];

export type ClientProcedureKind<TProcedureClient> = ClientProcedureTypes<TProcedureClient>["kind"];

export type ClientProcedureSource<TProcedureClient> =
  ClientProcedureTypes<TProcedureClient>["procedure"];

export type ClientProcedurePagination<TProcedureClient> =
  ClientProcedureTypes<TProcedureClient>["pagination"];

/**
 * Projects a contract procedure and one client's reachable boundary failures
 * into the single associated-type record carried by its callable.
 */
export type ProcedureClientTypesFor<
  TProcedure,
  TBoundaryError extends AnyPublicTaggedError,
> = TProcedure extends {
  readonly _def: {
    readonly input: WireCodec<infer TInput, WireValue>;
    readonly output: WireCodec<infer TOutput, WireValue>;
    readonly definitions: infer TDefinitions;
    readonly kind: infer TKind;
    readonly capability: infer TCapability;
  };
}
  ? TDefinitions extends ErrorDefinitionMap
    ? TKind extends "query" | "mutation" | "subscription"
      ? ProcedureClientTypes<
          TInput,
          TOutput,
          ErrorUnion<TDefinitions> | TBoundaryError,
          TKind,
          Extract<TProcedure, ClientProcedure>,
          InferClientPagination<TCapability>
        >
      : never
    : never
  : never;

type ProcedureClientFromTypes<
  TTypes extends AnyProcedureClientTypes,
  TOptions,
  TSubscriptionMode extends "managed" | "iterable",
> =
  TTypes extends ProcedureClientTypes<
    infer TInput,
    infer TOutput,
    infer TError,
    infer TKind,
    any,
    any,
    any
  >
    ? TKind extends "subscription"
      ? ((
          ...args: ClientCallArgs<TInput, TOptions>
        ) => SubscriptionResult<TSubscriptionMode, TOutput, TError>) & {
          readonly $kind: TKind;
        } & ProcedureClientTypeCarrier<TTypes>
      : ((...args: ClientCallArgs<TInput, TOptions>) => Promise<Result<TOutput, TError>>) & {
          readonly $kind: TKind;
        } & ProcedureClientTypeCarrier<TTypes>
    : never;

/**
 * The shared callable algebra. Environments supply only their reachable
 * boundary errors, call options, and subscription lifetime shape.
 */
export type ProcedureClient<
  TProcedure,
  TBoundaryError extends AnyPublicTaggedError,
  TOptions,
  TSubscriptionMode extends "managed" | "iterable",
> = ProcedureClientFromTypes<
  ProcedureClientTypesFor<TProcedure, TBoundaryError>,
  TOptions,
  TSubscriptionMode
>;

export type ClientRecord<
  TRecord,
  TBoundaryError extends AnyPublicTaggedError,
  TOptions,
  TSubscriptionMode extends "managed" | "iterable",
> = {
  readonly [TKey in keyof TRecord]: TRecord[TKey] extends ClientProcedure
    ? ProcedureClient<TRecord[TKey], TBoundaryError, TOptions, TSubscriptionMode>
    : TRecord[TKey] extends ClientRouterRecord
      ? ClientRecord<TRecord[TKey], TBoundaryError, TOptions, TSubscriptionMode>
      : never;
};

type ClientRecordError<TRecord> = {
  readonly [TKey in keyof TRecord]: TRecord[TKey] extends ClientProcedure
    ? TRecord[TKey] extends {
        readonly _def: { readonly definitions: infer TDefinitions extends ErrorDefinitionMap };
      }
      ? ErrorUnion<TDefinitions>
      : never
    : TRecord[TKey] extends ClientRouterRecord
      ? ClientRecordError<TRecord[TKey]>
      : never;
}[keyof TRecord];

type ClientRouterRecordOf<TRouter> =
  TRouter extends Router<any, infer TRecord>
    ? TRecord
    : TRouter extends RouterContract<any, infer TRecord>
      ? TRecord
      : never;

/** Every public failure reachable through one concrete client environment. */
export type ClientErrorOf<TRouter, TBoundaryError extends AnyPublicTaggedError> = Extract<
  ClientRecordError<ClientRouterRecordOf<TRouter>> | TBoundaryError,
  AnyPublicTaggedError
>;

export type BaseClientOf<
  TRouter,
  TBoundaryError extends AnyPublicTaggedError,
  TOptions,
  TSubscriptionMode extends "managed" | "iterable",
> = (TRouter extends Router<any, infer TRecord>
  ? ClientRecord<TRecord, TBoundaryError, TOptions, TSubscriptionMode>
  : TRouter extends RouterContract<any, infer TRecord>
    ? ClientRecord<TRecord, TBoundaryError, TOptions, TSubscriptionMode>
    : never) & {
  readonly $errors: ClientErrorRegistry<ClientErrorOf<TRouter, TBoundaryError>>;
};

/** Extracts the flattened, public error union carried by a client instance. */
export type ClientErrors<TClient> = TClient extends {
  readonly $errors: ClientErrorRegistry<infer E>;
}
  ? E
  : never;

export const createClientErrorRegistry = <E extends AnyPublicTaggedError>(
  router: ClientRouter,
  boundaryDefinitions: readonly AnyPublicErrorDefinition[],
): ClientErrorRegistry<E> => {
  const definitions = new Map<string, AnyPublicErrorDefinition>();
  for (const definition of [...router.errors.values(), ...boundaryDefinitions]) {
    definitions.set(definition.tag, definition);
  }
  return Object.freeze({
    definitions,
    is: (value: unknown): value is E =>
      isTaggedError(value) &&
      value.visibility === "public" &&
      definitions.get(value._tag)?.is(value) === true,
  });
};

import {
  isTaggedError,
  type AnyPublicErrorDefinition,
  type AnyPublicTaggedError,
  type AnyTaggedError,
} from "../error.js";
import type { Result } from "../result.js";
import type {
  AnyProcedure,
  AnyProcedureContract,
  ContractRouterRecord,
  ErrorDefinitionMap,
  ErrorUnion,
  ProcedureContractManifest,
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
  close(): void;
}

/** Runtime definitions plus an app-wide type guard for a client's public error union. */
export interface ClientErrorRegistry<E extends AnyPublicTaggedError> {
  readonly definitions: ReadonlyMap<string, AnyPublicErrorDefinition>;
  is(value: unknown): value is E;
}

/** Zero-input procedures may be called with no argument. */
export type ClientCallArgs<TInput, TOptions> =
  Record<never, never> extends TInput
    ? [input?: TInput, options?: TOptions]
    : [input: TInput, options?: TOptions];

type SubscriptionResult<
  TMode extends "managed" | "iterable",
  TOutput,
  TError extends AnyTaggedError,
> = TMode extends "managed"
  ? ResultSubscription<TOutput, TError>
  : AsyncIterable<Result<TOutput, TError>>;

/**
 * The shared callable algebra. Environments supply only their reachable
 * boundary errors, call options, and subscription lifetime shape.
 */
export type ProcedureClient<
  TProcedure,
  TBoundaryError extends AnyPublicTaggedError,
  TOptions,
  TSubscriptionMode extends "managed" | "iterable",
> = TProcedure extends {
  readonly _def: ProcedureContractManifest<
    any,
    infer TInput,
    infer TOutput,
    infer TDefinitions,
    infer TKind
  >;
}
  ? TDefinitions extends ErrorDefinitionMap
    ? TKind extends "subscription"
      ? ((
          input: TInput,
          options?: TOptions,
        ) => SubscriptionResult<
          TSubscriptionMode,
          TOutput,
          ErrorUnion<TDefinitions> | TBoundaryError
        >) & { readonly $kind: "subscription" }
      : ((
          ...args: ClientCallArgs<TInput, TOptions>
        ) => Promise<Result<TOutput, ErrorUnion<TDefinitions> | TBoundaryError>>) & {
          readonly $kind: TKind;
        }
    : never
  : never;

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

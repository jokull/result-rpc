import type { AnyPublicErrorDefinition } from "./error.js";
import type { RpcFactoryTypeCarrier, RpcFactoryTypes } from "./factory-types.js";
import {
  type DefinitionMapCompatibility,
  type ErrorDefinitionMap,
  type MergeDefinitionMaps,
} from "./error-map.js";
import type { AnyModel, ModelKeyInput } from "./model.js";
import type {
  PaginatedProcedureCapability,
  UnaryProcedureCapability,
} from "./procedure-capability.js";
import { procedureDeclaration, type ProcedureDeclaration } from "./procedure-declaration.js";
import type {
  ContractRouterRecord,
  ContextCompatibleContractRecord,
  RouterContract,
  RouterTypes,
} from "./server/contract.js";
import type {
  AnyProcedureContract,
  AnyProcedureTypes,
  CompleteProcedureTypes,
  Page,
  PageRequest,
  ProcedureAffectsInput,
  ProcedureContract,
  ProcedureInputConstraint,
  QueryAffectsTarget,
  ProcedureTerminalConstraint,
  ProcedureTypes,
  WithProcedureDefinitions,
  WithProcedureHeaders,
  WithProcedureInput,
  WithProcedureKinds,
  WithProcedureMappedInput,
  WithProcedureOutput,
} from "./procedure-types.js";
import { wire, type EmptyObject, type WireCodec, type WireValue } from "./wire.js";

/** The browser-safe surface used to declare shared RPC contracts. */
export interface ContractFactory<TRootContext> extends RpcFactoryTypeCarrier<
  RpcFactoryTypes<TRootContext>
> {
  procedure(): ContractProcedureBuilder<
    ProcedureTypes<
      TRootContext,
      TRootContext,
      EmptyObject,
      never,
      {},
      "query" | "mutation" | "subscription",
      UnaryProcedureCapability
    >
  >;
  contract<const TRecord extends ContractRouterRecord>(
    record: TRecord & ContextCompatibleContractRecord<TRootContext, TRecord>,
  ): RouterContract<RouterTypes<TRootContext, TRecord>> & TRecord;
}

/**
 * Builds procedure descriptions only. Handlers, middleware, and executable
 * routers belong to `serverRpc` from `result-rpc/server`.
 */
export class ContractProcedureBuilder<TTypes extends AnyProcedureTypes> {
  constructor(private readonly declaration: ProcedureDeclaration<TTypes>) {}

  headers(): ContractProcedureBuilder<WithProcedureHeaders<TTypes>> {
    return new ContractProcedureBuilder(this.declaration.headers());
  }

  writes<TModel extends AnyModel>(
    model: TModel,
    map: (input: TTypes["input"]) => ModelKeyInput<TModel>,
  ): ContractProcedureBuilder<
    WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>
  > {
    return new ContractProcedureBuilder(this.declaration.writes(model, map));
  }

  affects<const TTarget extends QueryAffectsTarget>(
    target: TTarget,
    map?: (input: TTypes["input"]) => ProcedureAffectsInput<TTarget>,
  ): ContractProcedureBuilder<
    WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>
  > {
    return new ContractProcedureBuilder(this.declaration.affects(target, map));
  }

  input<TNewInput, TEncoded extends WireValue>(
    this: ContractProcedureBuilder<TTypes> & ProcedureInputConstraint<TTypes>,
    codec: WireCodec<TNewInput, TEncoded>,
  ): ContractProcedureBuilder<WithProcedureInput<TTypes, TNewInput>> {
    return new ContractProcedureBuilder(this.declaration.input(codec));
  }

  output<TNewOutput, TEncoded extends WireValue>(
    codec: WireCodec<TNewOutput, TEncoded>,
  ): ContractProcedureBuilder<WithProcedureOutput<TTypes, TNewOutput>> {
    return new ContractProcedureBuilder(this.declaration.output(codec));
  }

  errors<const TNewDefinitions extends ErrorDefinitionMap>(
    definitions: TNewDefinitions &
      DefinitionMapCompatibility<TTypes["definitions"], NoInfer<TNewDefinitions>>,
  ): ContractProcedureBuilder<
    WithProcedureDefinitions<TTypes, MergeDefinitionMaps<TTypes["definitions"], TNewDefinitions>>
  > {
    return new ContractProcedureBuilder(this.declaration.errors<TNewDefinitions>(definitions));
  }

  query(
    this: ContractProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">,
  ): ProcedureContract<
    CompleteProcedureTypes<TTypes, "query", UnaryProcedureCapability<TTypes["writesHeaders"]>>
  > {
    return this.finish("query");
  }

  mutation(
    this: ContractProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "mutation">,
  ): ProcedureContract<
    CompleteProcedureTypes<TTypes, "mutation", UnaryProcedureCapability<TTypes["writesHeaders"]>>
  > {
    return this.finish("mutation");
  }

  subscription(
    this: ContractProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "subscription">,
  ): ProcedureContract<
    CompleteProcedureTypes<
      TTypes,
      "subscription",
      UnaryProcedureCapability<TTypes["writesHeaders"]>
    >
  > {
    return this.finish("subscription");
  }

  paginate<TCursor>(
    this: ContractProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">,
    options: {
      readonly cursor: WireCodec<TCursor, WireValue>;
    },
  ): ProcedureContract<
    CompleteProcedureTypes<
      TTypes,
      "query",
      PaginatedProcedureCapability<
        TTypes["input"],
        TCursor,
        TTypes["output"],
        TTypes["writesHeaders"]
      >,
      PageRequest<TTypes["input"], TCursor>,
      Page<TTypes["output"], TCursor>
    >
  > {
    return Object.freeze({
      _kind: "procedure-contract" as const,
      _def: this.declaration.paginated(options.cursor),
    });
  }

  private finish<TKind extends "query" | "mutation" | "subscription">(
    kind: TKind,
  ): ProcedureContract<
    CompleteProcedureTypes<TTypes, TKind, UnaryProcedureCapability<TTypes["writesHeaders"]>>
  > {
    return Object.freeze({
      _kind: "procedure-contract" as const,
      _def: this.declaration.unary(kind),
    });
  }
}

const RESERVED_CONTRACT_KEYS = new Set([
  "_kind",
  "record",
  "procedures",
  "errors",
  "$errors",
  "_rootContext",
]);

const createContract = <TRootContext, const TRecord extends ContractRouterRecord>(
  record: TRecord,
): RouterContract<RouterTypes<TRootContext, TRecord>> & TRecord => {
  const procedures = new Map<string, AnyProcedureContract>();
  const isProcedureContract = (
    value: AnyProcedureContract | ContractRouterRecord,
  ): value is AnyProcedureContract => "_kind" in value && value._kind === "procedure-contract";
  const visit = (node: ContractRouterRecord, prefix: readonly string[]) => {
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key];
      if (isProcedureContract(value)) {
        procedures.set(path.join("."), value);
      } else {
        visit(value, path);
      }
    }
  };
  visit(record, []);
  for (const key of Object.keys(record)) {
    if (RESERVED_CONTRACT_KEYS.has(key)) {
      throw new TypeError(`Contract key ${key} collides with a reserved property`);
    }
  }
  const errors = collectErrorRegistry(procedures);
  // Record traversal validated every leaf and reserved key. Spreading the
  // exact input record plus metadata is the runtime form of this intersection.
  return Object.freeze({
    ...record,
    _kind: "router-contract" as const,
    record,
    procedures,
    errors,
  }) as RouterContract<RouterTypes<TRootContext, TRecord>> & TRecord;
};

const collectErrorRegistry = (
  procedures: ReadonlyMap<string, AnyProcedureContract>,
): ReadonlyMap<string, AnyPublicErrorDefinition> => {
  const byTag = new Map<string, AnyPublicErrorDefinition>();
  const firstSeen = new Map<string, string>();
  for (const [path, procedure] of procedures) {
    for (const definition of Object.values(procedure._def.definitions)) {
      const existing = byTag.get(definition.tag);
      if (existing && existing !== definition) {
        throw new TypeError(
          `Error tag ${definition.tag} has conflicting definitions in ${firstSeen.get(definition.tag)} and ${path}; share one definition instead of redeclaring the tag`,
        );
      }
      if (!existing) {
        byTag.set(definition.tag, definition);
        firstSeen.set(definition.tag, path);
      }
    }
  }
  return byTag;
};

const factory = <TRootContext>(): ContractFactory<TRootContext> => ({
  procedure: () =>
    new ContractProcedureBuilder<
      ProcedureTypes<
        TRootContext,
        TRootContext,
        EmptyObject,
        never,
        {},
        "query" | "mutation" | "subscription",
        UnaryProcedureCapability
      >
    >(procedureDeclaration(wire.object({}), {}, false)),
  contract: (record) => createContract<TRootContext, typeof record>(record),
});

export const rpc = Object.assign(factory<unknown>(), {
  context: <TRootContext>() => factory<TRootContext>(),
});

import type { AnyPublicErrorDefinition } from "./error.js";
import {
  mergeDefinitionMaps,
  type DefinitionMapCompatibility,
  type ErrorDefinitionMap,
  type MergeDefinitionMaps,
} from "./error-map.js";
import type { AnyModel, ModelKeyInput } from "./model.js";
import {
  PaginatedProcedureCapability,
  type UnaryProcedureCapability,
  unaryProcedureCapability,
} from "./procedure-capability.js";
import type {
  AffectsEntry,
  AnyProcedureContract,
  ContractRouterRecord,
  ContextCompatibleContractRecord,
  Page,
  PageRequest,
  PaginationManifest,
  ProcedureAffectsInput,
  ProcedureContract,
  RouterContract,
  WritesEntry,
} from "./server/contract.js";
import {
  wire,
  type AnyWireCodec,
  type EmptyObject,
  type WireCodec,
  type WireValue,
} from "./wire.js";

/** The browser-safe surface used to declare shared RPC contracts. */
export interface ContractFactory<TRootContext> {
  procedure(): ContractProcedureBuilder<TRootContext>;
  contract<const TRecord extends ContractRouterRecord>(
    record: TRecord & ContextCompatibleContractRecord<TRootContext, TRecord>,
  ): RouterContract<TRootContext, TRecord> & TRecord;
}

/** Localizes the existential input erasure when a typed manifest is compiled. */
const eraseManifestMapper =
  <TInput, TOutput>(map: (input: TInput) => TOutput): ((input: unknown) => TOutput) =>
  // The runtime invokes the compiled mapper only with this procedure's validated input.
  (input) =>
    map(input as TInput);

/**
 * Builds procedure descriptions only. Handlers, middleware, and executable
 * routers belong to `serverRpc` from `result-rpc/server`.
 */
export class ContractProcedureBuilder<
  TRootContext,
  TInput = EmptyObject,
  TOutput = never,
  TDefinitions extends ErrorDefinitionMap = {},
  TWritesHeaders extends boolean = false,
> {
  constructor(
    private readonly inputCodec?: WireCodec<TInput, WireValue>,
    private readonly outputCodec?: WireCodec<TOutput, WireValue>,
    private readonly definitions: TDefinitions = {} as TDefinitions,
    private readonly affectsEntries: readonly AffectsEntry[] = [],
    private readonly writesEntries: readonly WritesEntry[] = [],
    private readonly declaresHeaders: TWritesHeaders = false as TWritesHeaders,
  ) {}

  headers(): ContractProcedureBuilder<TRootContext, TInput, TOutput, TDefinitions, true> {
    return new ContractProcedureBuilder<TRootContext, TInput, TOutput, TDefinitions, true>(
      this.inputCodec,
      this.outputCodec,
      this.definitions,
      this.affectsEntries,
      this.writesEntries,
      true,
    );
  }

  writes<TModel extends AnyModel>(
    model: TModel,
    map: (input: TInput) => ModelKeyInput<TModel>,
  ): ContractProcedureBuilder<TRootContext, TInput, TOutput, TDefinitions, TWritesHeaders> {
    return new ContractProcedureBuilder<
      TRootContext,
      TInput,
      TOutput,
      TDefinitions,
      TWritesHeaders
    >(
      this.inputCodec,
      this.outputCodec,
      this.definitions,
      this.affectsEntries,
      [...this.writesEntries, { model, map: eraseManifestMapper(map) }],
      this.declaresHeaders,
    );
  }

  affects<const TTarget extends ProcedureContract<any, any, any, any, "query", any>>(
    target: TTarget,
    map?: (input: TInput) => ProcedureAffectsInput<TTarget>,
  ): ContractProcedureBuilder<TRootContext, TInput, TOutput, TDefinitions, TWritesHeaders> {
    if (target._def.kind !== "query") {
      throw new TypeError("affects() targets must be query procedures");
    }
    const entry: AffectsEntry =
      map === undefined ? { target } : { target, map: eraseManifestMapper(map) };
    return new ContractProcedureBuilder<
      TRootContext,
      TInput,
      TOutput,
      TDefinitions,
      TWritesHeaders
    >(
      this.inputCodec,
      this.outputCodec,
      this.definitions,
      [...this.affectsEntries, entry],
      this.writesEntries,
      this.declaresHeaders,
    );
  }

  input<TNewInput, TEncoded extends WireValue>(
    codec: WireCodec<TNewInput, TEncoded>,
  ): ContractProcedureBuilder<TRootContext, TNewInput, TOutput, TDefinitions, TWritesHeaders> {
    return new ContractProcedureBuilder<
      TRootContext,
      TNewInput,
      TOutput,
      TDefinitions,
      TWritesHeaders
    >(
      codec as WireCodec<TNewInput, WireValue>,
      this.outputCodec,
      this.definitions,
      this.affectsEntries,
      this.writesEntries,
      this.declaresHeaders,
    );
  }

  output<TNewOutput, TEncoded extends WireValue>(
    codec: WireCodec<TNewOutput, TEncoded>,
  ): ContractProcedureBuilder<TRootContext, TInput, TNewOutput, TDefinitions, TWritesHeaders> {
    return new ContractProcedureBuilder<
      TRootContext,
      TInput,
      TNewOutput,
      TDefinitions,
      TWritesHeaders
    >(
      this.inputCodec,
      codec as WireCodec<TNewOutput, WireValue>,
      this.definitions,
      this.affectsEntries,
      this.writesEntries,
      this.declaresHeaders,
    );
  }

  errors<const TNewDefinitions extends ErrorDefinitionMap>(
    definitions: TNewDefinitions &
      DefinitionMapCompatibility<TDefinitions, NoInfer<TNewDefinitions>>,
  ): ContractProcedureBuilder<
    TRootContext,
    TInput,
    TOutput,
    MergeDefinitionMaps<TDefinitions, TNewDefinitions>,
    TWritesHeaders
  > {
    return new ContractProcedureBuilder<
      TRootContext,
      TInput,
      TOutput,
      MergeDefinitionMaps<TDefinitions, TNewDefinitions>,
      TWritesHeaders
    >(
      this.inputCodec,
      this.outputCodec,
      mergeDefinitionMaps(this.definitions, definitions),
      this.affectsEntries,
      this.writesEntries,
      this.declaresHeaders,
    );
  }

  query(): ProcedureContract<
    TRootContext,
    TInput,
    TOutput,
    TDefinitions,
    "query",
    UnaryProcedureCapability<TWritesHeaders>
  > {
    return this.finish("query");
  }

  mutation(): ProcedureContract<
    TRootContext,
    TInput,
    TOutput,
    TDefinitions,
    "mutation",
    UnaryProcedureCapability<TWritesHeaders>
  > {
    return this.finish("mutation");
  }

  subscription(): ProcedureContract<
    TRootContext,
    TInput,
    TOutput,
    TDefinitions,
    "subscription",
    UnaryProcedureCapability<TWritesHeaders>
  > {
    return this.finish("subscription");
  }

  paginate<TCursor>(options: {
    readonly cursor: WireCodec<TCursor, WireValue>;
  }): ProcedureContract<
    TRootContext,
    PageRequest<TInput, TCursor>,
    Page<TOutput, TCursor>,
    TDefinitions,
    "query",
    PaginatedProcedureCapability<TInput, TCursor, TOutput, TWritesHeaders>
  > {
    if (!this.outputCodec) {
      throw new TypeError("paginate() requires an output codec declaring the row shape");
    }
    this.assertKindAllowsDeclarations("query");
    const item = this.outputCodec as AnyWireCodec;
    const cursorOrNull = wire.union([options.cursor, wire.null]);
    const input = wire.object({
      list: (this.inputCodec ?? wire.object({})) as AnyWireCodec,
      cursor: cursorOrNull as AnyWireCodec,
    }) as unknown as WireCodec<PageRequest<TInput, TCursor>, WireValue>;
    const output = wire.object({
      items: wire.array(item),
      nextCursor: cursorOrNull as AnyWireCodec,
    }) as unknown as WireCodec<Page<TOutput, TCursor>, WireValue>;
    const pagination: PaginationManifest = Object.freeze({ cursor: options.cursor, item });
    return Object.freeze({
      _kind: "procedure-contract" as const,
      _def: Object.freeze({
        kind: "query" as const,
        input,
        output,
        definitions: this.definitions,
        capability: new PaginatedProcedureCapability<TInput, TCursor, TOutput, TWritesHeaders>(
          this.declaresHeaders,
        ),
        pagination,
        ...(this.declaresHeaders ? { writesHeaders: true as const } : {}),
      }),
    });
  }

  private finish<TKind extends "query" | "mutation" | "subscription">(
    kind: TKind,
  ): ProcedureContract<
    TRootContext,
    TInput,
    TOutput,
    TDefinitions,
    TKind,
    UnaryProcedureCapability<TWritesHeaders>
  > {
    if (!this.outputCodec) throw new TypeError("A procedure requires an output codec");
    this.assertKindAllowsDeclarations(kind);
    return Object.freeze({
      _kind: "procedure-contract" as const,
      _def: Object.freeze({
        kind,
        input: this.inputCodec ?? (wire.object({}) as WireCodec<TInput, WireValue>),
        output: this.outputCodec,
        definitions: this.definitions,
        capability: unaryProcedureCapability(this.declaresHeaders),
        ...(this.affectsEntries.length === 0 ? {} : { affects: this.affectsEntries }),
        ...(this.writesEntries.length === 0 ? {} : { writes: this.writesEntries }),
        ...(this.declaresHeaders ? { writesHeaders: true as const } : {}),
      }),
    });
  }

  private assertKindAllowsDeclarations(kind: string): void {
    if (this.affectsEntries.length > 0 && kind !== "mutation") {
      throw new TypeError(
        "Only mutations declare .affects(); queries are invalidated, not invalidating",
      );
    }
    if (this.writesEntries.length > 0 && kind !== "mutation") {
      throw new TypeError("Only mutations declare .writes()");
    }
    if (this.declaresHeaders && kind === "subscription") {
      throw new TypeError(
        "A subscription cannot write response headers: its response is already on the wire " +
          "before the stream runs. Set the header in the request that opens the stream instead.",
      );
    }
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
): RouterContract<TRootContext, TRecord> & TRecord => {
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
  return Object.freeze({
    ...record,
    _kind: "router-contract" as const,
    record,
    procedures,
    errors,
  }) as RouterContract<TRootContext, TRecord> & TRecord;
};

const collectErrorRegistry = (
  procedures: ReadonlyMap<string, AnyProcedureContract>,
): ReadonlyMap<string, AnyPublicErrorDefinition> => {
  const byTag = new Map<string, AnyPublicErrorDefinition>();
  const firstSeen = new Map<string, string>();
  for (const [path, procedure] of procedures) {
    for (const definition of Object.values(
      procedure._def.definitions as ErrorDefinitionMap,
    ) as AnyPublicErrorDefinition[]) {
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
  procedure: () => new ContractProcedureBuilder<TRootContext>(),
  contract: (record) => createContract<TRootContext, typeof record>(record),
});

export const rpc = Object.assign(factory<unknown>(), {
  context: <TRootContext>() => factory<TRootContext>(),
});

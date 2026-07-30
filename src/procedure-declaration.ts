import {
  mergeDefinitionMaps,
  type DefinitionMapCompatibility,
  type ErrorDefinitionMap,
  type MergeDefinitionMaps,
} from "./error-map.js";
import type { AnyModel, ModelKeyInput } from "./model.js";
import { paginationCodecs } from "./procedure-codecs.js";
import {
  PaginatedProcedureCapability,
  type ProcedureCapability,
  type UnaryProcedureCapability,
  unaryProcedureCapability,
} from "./procedure-capability.js";
import type {
  AffectsEntry,
  AnyProcedureTypes,
  CompleteProcedureTypes,
  Page,
  PageRequest,
  PaginationManifest,
  ProcedureAffectsInput,
  ProcedureContractManifest,
  ProcedureKind,
  QueryAffectsTarget,
  WithProcedureContext,
  WithProcedureDefinitions,
  WithProcedureHeaders,
  WithProcedureInput,
  WithProcedureKinds,
  WithProcedureMappedInput,
  WithProcedureOutput,
  WritesEntry,
} from "./procedure-types.js";
import type { WireCodec, WireValue } from "./wire.js";

export interface PendingAffectsEntry<TInput> {
  readonly target: QueryAffectsTarget;
  readonly map?: (input: TInput) => unknown;
}

export interface PendingWritesEntry<TInput> {
  readonly model: AnyModel;
  readonly map: (input: TInput) => ModelKeyInput;
}

/**
 * The sole input-erasure boundary for cache declarations. Until a procedure
 * reaches a terminal, every mapper remains a function of its exact decoded
 * input. The terminal compiler erases that input only after binding the mapper
 * to the final input codec carried by the same declaration state.
 */
const compileManifestMapper =
  <TInput, TOutput>(map: (input: TInput) => TOutput): ((input: unknown) => TOutput) =>
  (input) =>
    map(input as TInput);

const compileAffects = <TInput>(
  entries: readonly PendingAffectsEntry<TInput>[],
): readonly AffectsEntry[] =>
  entries.map(({ target, map }) =>
    map === undefined ? { target } : { target, map: compileManifestMapper(map) },
  );

const compileWrites = <TInput>(
  entries: readonly PendingWritesEntry<TInput>[],
): readonly WritesEntry[] =>
  entries.map(({ model, map }) => ({ model, map: compileManifestMapper(map) }));

/**
 * Immutable declaration algebra shared by contract-only and executable
 * builders. Public builders only project its transitions into their own
 * terminal style; codecs, errors, cache declarations, header capability, and
 * terminal manifest compilation live here exactly once.
 */
export class ProcedureDeclaration<TTypes extends AnyProcedureTypes> {
  constructor(
    private readonly inputCodec: WireCodec<TTypes["input"], WireValue>,
    private readonly outputCodec: WireCodec<TTypes["output"], WireValue> | undefined,
    readonly definitions: TTypes["definitions"],
    private readonly affectsEntries: readonly PendingAffectsEntry<TTypes["input"]>[],
    private readonly writesEntries: readonly PendingWritesEntry<TTypes["input"]>[],
    readonly writesHeaders: TTypes["writesHeaders"],
  ) {}

  input<TNewInput, TEncoded extends WireValue>(
    codec: WireCodec<TNewInput, TEncoded>,
  ): ProcedureDeclaration<WithProcedureInput<TTypes, TNewInput>> {
    if (this.affectsEntries.length > 0 || this.writesEntries.length > 0) {
      throw new TypeError("input() must be declared before affects() or writes()");
    }
    return new ProcedureDeclaration<WithProcedureInput<TTypes, TNewInput>>(
      codec,
      this.outputCodec,
      this.definitions,
      [],
      [],
      this.writesHeaders,
    );
  }

  output<TNewOutput, TEncoded extends WireValue>(
    codec: WireCodec<TNewOutput, TEncoded>,
  ): ProcedureDeclaration<WithProcedureOutput<TTypes, TNewOutput>> {
    return new ProcedureDeclaration<WithProcedureOutput<TTypes, TNewOutput>>(
      this.inputCodec,
      codec,
      this.definitions,
      this.affectsEntries,
      this.writesEntries,
      this.writesHeaders,
    );
  }

  errors<const TNewDefinitions extends ErrorDefinitionMap>(
    definitions: TNewDefinitions &
      DefinitionMapCompatibility<TTypes["definitions"], NoInfer<TNewDefinitions>>,
  ): ProcedureDeclaration<
    WithProcedureDefinitions<TTypes, MergeDefinitionMaps<TTypes["definitions"], TNewDefinitions>>
  > {
    return new ProcedureDeclaration<
      WithProcedureDefinitions<TTypes, MergeDefinitionMaps<TTypes["definitions"], TNewDefinitions>>
    >(
      this.inputCodec,
      this.outputCodec,
      mergeDefinitionMaps(this.definitions, definitions),
      this.affectsEntries,
      this.writesEntries,
      this.writesHeaders,
    );
  }

  headers(): ProcedureDeclaration<WithProcedureHeaders<TTypes>> {
    return new ProcedureDeclaration<WithProcedureHeaders<TTypes>>(
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
    map: (input: TTypes["input"]) => ModelKeyInput<TModel>,
  ): ProcedureDeclaration<
    WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>
  > {
    return new ProcedureDeclaration<
      WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>
    >(
      this.inputCodec,
      this.outputCodec,
      this.definitions,
      this.affectsEntries,
      [...this.writesEntries, { model, map }],
      this.writesHeaders,
    );
  }

  affects<const TTarget extends QueryAffectsTarget>(
    target: TTarget,
    map?: (input: TTypes["input"]) => ProcedureAffectsInput<TTarget>,
  ): ProcedureDeclaration<
    WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>
  > {
    if (target._def.kind !== "query") {
      throw new TypeError("affects() targets must be query procedures");
    }
    const entry: PendingAffectsEntry<TTypes["input"]> =
      map === undefined ? { target } : { target, map };
    return new ProcedureDeclaration<
      WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>
    >(
      this.inputCodec,
      this.outputCodec,
      this.definitions,
      [...this.affectsEntries, entry],
      this.writesEntries,
      this.writesHeaders,
    );
  }

  rebind<
    TContext,
    TDefinitions extends ErrorDefinitionMap,
    TCapability extends ProcedureCapability,
  >(
    definitions: TDefinitions,
    writesHeaders: TCapability["writesHeaders"],
  ): ProcedureDeclaration<WithProcedureContext<TTypes, TContext, TDefinitions, TCapability>> {
    return new ProcedureDeclaration<
      WithProcedureContext<TTypes, TContext, TDefinitions, TCapability>
    >(
      this.inputCodec,
      this.outputCodec,
      definitions,
      this.affectsEntries,
      this.writesEntries,
      writesHeaders,
    );
  }

  unary<TKind extends ProcedureKind>(
    kind: TKind,
  ): ProcedureContractManifest<
    CompleteProcedureTypes<TTypes, TKind, UnaryProcedureCapability<TTypes["writesHeaders"]>>
  > {
    if (!this.outputCodec) throw new TypeError("A procedure requires an output codec");
    this.assertKindAllowsDeclarations(kind);
    const affects = compileAffects(this.affectsEntries);
    const writes = compileWrites(this.writesEntries);
    return Object.freeze({
      kind,
      input: this.inputCodec,
      output: this.outputCodec,
      definitions: this.definitions,
      capability: unaryProcedureCapability(this.writesHeaders),
      ...(affects.length === 0 ? {} : { affects }),
      ...(writes.length === 0 ? {} : { writes }),
      ...(this.writesHeaders ? { writesHeaders: true as const } : {}),
    });
  }

  paginated<TCursor>(
    cursor: WireCodec<TCursor, WireValue>,
  ): ProcedureContractManifest<
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
    if (!this.outputCodec) {
      throw new TypeError("paginate() requires an output codec declaring the row shape");
    }
    this.assertKindAllowsDeclarations("query");
    const item = this.outputCodec;
    const codecs = paginationCodecs(this.inputCodec, cursor, item);
    const pagination: PaginationManifest = Object.freeze({ cursor, item });
    return Object.freeze({
      kind: "query",
      input: codecs.input,
      output: codecs.output,
      definitions: this.definitions,
      capability: new PaginatedProcedureCapability<
        TTypes["input"],
        TCursor,
        TTypes["output"],
        TTypes["writesHeaders"]
      >(this.writesHeaders),
      pagination,
      ...(this.writesHeaders ? { writesHeaders: true as const } : {}),
    });
  }

  private assertKindAllowsDeclarations(kind: ProcedureKind): void {
    if (this.affectsEntries.length > 0 && kind !== "mutation") {
      throw new TypeError(
        "Only mutations declare .affects(); queries are invalidated, not invalidating",
      );
    }
    if (this.writesEntries.length > 0 && kind !== "mutation") {
      throw new TypeError("Only mutations declare .writes()");
    }
    if (this.writesHeaders && kind === "subscription") {
      throw new TypeError(
        "A subscription cannot write response headers: its response is already on the wire " +
          "before the stream — and therefore any middleware or handler — runs. Set the header " +
          "in the request that opens the stream instead.",
      );
    }
  }
}

export const procedureDeclaration = <TTypes extends AnyProcedureTypes>(
  input: WireCodec<TTypes["input"], WireValue>,
  definitions: TTypes["definitions"],
  writesHeaders: TTypes["writesHeaders"],
): ProcedureDeclaration<TTypes> =>
  new ProcedureDeclaration(input, undefined, definitions, [], [], writesHeaders);

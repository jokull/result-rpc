import { type DefinitionMapCompatibility, type ErrorDefinitionMap, type MergeDefinitionMaps } from "./error-map.js";
import type { AnyModel, ModelKeyInput } from "./model.js";
import { PaginatedProcedureCapability, type ProcedureCapability, type UnaryProcedureCapability } from "./procedure-capability.js";
import type { AnyProcedureTypes, CompleteProcedureTypes, Page, PageRequest, ProcedureAffectsInput, ProcedureContractManifest, ProcedureKind, QueryAffectsTarget, WithProcedureContext, WithProcedureDefinitions, WithProcedureHeaders, WithProcedureResumable, WithProcedureInput, WithProcedureKinds, WithProcedureMappedInput, WithProcedureOutput } from "./procedure-types.js";
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
 * Immutable declaration algebra shared by contract-only and executable
 * builders. Public builders only project its transitions into their own
 * terminal style; codecs, errors, cache declarations, header capability, and
 * terminal manifest compilation live here exactly once.
 */
export declare class ProcedureDeclaration<TTypes extends AnyProcedureTypes> {
    private readonly inputCodec;
    private readonly outputCodec;
    readonly definitions: TTypes["definitions"];
    private readonly affectsEntries;
    private readonly writesEntries;
    readonly writesHeaders: TTypes["writesHeaders"];
    /**
     * Set by `.resumable()`. Pure, and derived from the decoded output, so the
     * client computes the same resume token from the value it just received —
     * no event id rides the wire frame.
     */
    readonly resumableEventId: ((value: TTypes["output"]) => string) | undefined;
    constructor(inputCodec: WireCodec<TTypes["input"], WireValue>, outputCodec: WireCodec<TTypes["output"], WireValue> | undefined, definitions: TTypes["definitions"], affectsEntries: readonly PendingAffectsEntry<TTypes["input"]>[], writesEntries: readonly PendingWritesEntry<TTypes["input"]>[], writesHeaders: TTypes["writesHeaders"], 
    /**
     * Set by `.resumable()`. Pure, and derived from the decoded output, so the
     * client computes the same resume token from the value it just received —
     * no event id rides the wire frame.
     */
    resumableEventId?: ((value: TTypes["output"]) => string) | undefined);
    input<TNewInput, TEncoded extends WireValue>(codec: WireCodec<TNewInput, TEncoded>): ProcedureDeclaration<WithProcedureInput<TTypes, TNewInput>>;
    output<TNewOutput, TEncoded extends WireValue>(codec: WireCodec<TNewOutput, TEncoded>): ProcedureDeclaration<WithProcedureOutput<TTypes, TNewOutput>>;
    errors<const TNewDefinitions extends ErrorDefinitionMap>(definitions: TNewDefinitions & DefinitionMapCompatibility<TTypes["definitions"], NoInfer<TNewDefinitions>>): ProcedureDeclaration<WithProcedureDefinitions<TTypes, MergeDefinitionMaps<TTypes["definitions"], TNewDefinitions>>>;
    headers(): ProcedureDeclaration<WithProcedureHeaders<TTypes>>;
    resumable(options: {
        readonly eventId: (value: TTypes["output"]) => string;
    }): ProcedureDeclaration<WithProcedureResumable<TTypes>>;
    writes<TModel extends AnyModel>(model: TModel, map: (input: TTypes["input"]) => ModelKeyInput<TModel>): ProcedureDeclaration<WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>>;
    affects<const TTarget extends QueryAffectsTarget>(target: TTarget, map?: (input: TTypes["input"]) => ProcedureAffectsInput<TTarget>): ProcedureDeclaration<WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>>;
    rebind<TContext, TDefinitions extends ErrorDefinitionMap, TCapability extends ProcedureCapability>(definitions: TDefinitions, writesHeaders: TCapability["writesHeaders"]): ProcedureDeclaration<WithProcedureContext<TTypes, TContext, TDefinitions, TCapability>>;
    unary<TKind extends ProcedureKind>(kind: TKind): ProcedureContractManifest<CompleteProcedureTypes<TTypes, TKind, UnaryProcedureCapability<TTypes["writesHeaders"]>>>;
    paginated<TCursor>(cursor: WireCodec<TCursor, WireValue>): ProcedureContractManifest<CompleteProcedureTypes<TTypes, "query", PaginatedProcedureCapability<TTypes["input"], TCursor, TTypes["output"], TTypes["writesHeaders"]>, PageRequest<TTypes["input"], TCursor>, Page<TTypes["output"], TCursor>>>;
    private assertKindAllowsDeclarations;
}
export declare const procedureDeclaration: <TTypes extends AnyProcedureTypes>(input: WireCodec<TTypes["input"], WireValue>, definitions: TTypes["definitions"], writesHeaders: TTypes["writesHeaders"]) => ProcedureDeclaration<TTypes>;

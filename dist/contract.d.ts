import type { RpcFactoryTypeCarrier, RpcFactoryTypes } from "./factory-types.js";
import { type DefinitionMapCompatibility, type ErrorDefinitionMap, type MergeDefinitionMaps } from "./error-map.js";
import type { AnyModel, ModelKeyInput } from "./model.js";
import type { PaginatedProcedureCapability, UnaryProcedureCapability } from "./procedure-capability.js";
import { type ProcedureDeclaration } from "./procedure-declaration.js";
import type { ContractRouterRecord, ContextCompatibleContractRecord, RouterContract, RouterTypes } from "./server/contract.js";
import type { AnyProcedureTypes, CompleteProcedureTypes, Page, PageRequest, ProcedureAffectsInput, ProcedureContract, ProcedureInputConstraint, QueryAffectsTarget, ProcedureTerminalConstraint, ProcedureTypes, WithProcedureDefinitions, WithProcedureHeaders, WithProcedureInput, WithProcedureKinds, WithProcedureMappedInput, WithProcedureOutput } from "./procedure-types.js";
import { type EmptyObject, type WireCodec, type WireValue } from "./wire.js";
/** The browser-safe surface used to declare shared RPC contracts. */
export interface ContractFactory<TRootContext> extends RpcFactoryTypeCarrier<RpcFactoryTypes<TRootContext>> {
    procedure(): ContractProcedureBuilder<ProcedureTypes<TRootContext, TRootContext, EmptyObject, never, {}, "query" | "mutation" | "subscription", UnaryProcedureCapability>>;
    contract<const TRecord extends ContractRouterRecord>(record: TRecord & ContextCompatibleContractRecord<TRootContext, TRecord>): RouterContract<RouterTypes<TRootContext, TRecord>> & TRecord;
}
/**
 * Builds procedure descriptions only. Handlers, middleware, and executable
 * routers belong to `serverRpc` from `result-rpc/server`.
 */
export declare class ContractProcedureBuilder<TTypes extends AnyProcedureTypes> {
    private readonly declaration;
    constructor(declaration: ProcedureDeclaration<TTypes>);
    headers(): ContractProcedureBuilder<WithProcedureHeaders<TTypes>>;
    writes<TModel extends AnyModel>(model: TModel, map: (input: TTypes["input"]) => ModelKeyInput<TModel>): ContractProcedureBuilder<WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>>;
    affects<const TTarget extends QueryAffectsTarget>(target: TTarget, map?: (input: TTypes["input"]) => ProcedureAffectsInput<TTarget>): ContractProcedureBuilder<WithProcedureMappedInput<WithProcedureKinds<TTypes, Extract<TTypes["kind"], "mutation">>>>;
    input<TNewInput, TEncoded extends WireValue>(this: ContractProcedureBuilder<TTypes> & ProcedureInputConstraint<TTypes>, codec: WireCodec<TNewInput, TEncoded>): ContractProcedureBuilder<WithProcedureInput<TTypes, TNewInput>>;
    output<TNewOutput, TEncoded extends WireValue>(codec: WireCodec<TNewOutput, TEncoded>): ContractProcedureBuilder<WithProcedureOutput<TTypes, TNewOutput>>;
    errors<const TNewDefinitions extends ErrorDefinitionMap>(definitions: TNewDefinitions & DefinitionMapCompatibility<TTypes["definitions"], NoInfer<TNewDefinitions>>): ContractProcedureBuilder<WithProcedureDefinitions<TTypes, MergeDefinitionMaps<TTypes["definitions"], TNewDefinitions>>>;
    query(this: ContractProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">): ProcedureContract<CompleteProcedureTypes<TTypes, "query", UnaryProcedureCapability<TTypes["writesHeaders"]>>>;
    mutation(this: ContractProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "mutation">): ProcedureContract<CompleteProcedureTypes<TTypes, "mutation", UnaryProcedureCapability<TTypes["writesHeaders"]>>>;
    subscription(this: ContractProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "subscription">): ProcedureContract<CompleteProcedureTypes<TTypes, "subscription", UnaryProcedureCapability<TTypes["writesHeaders"]>>>;
    paginate<TCursor>(this: ContractProcedureBuilder<TTypes> & ProcedureTerminalConstraint<TTypes, "query">, options: {
        readonly cursor: WireCodec<TCursor, WireValue>;
    }): ProcedureContract<CompleteProcedureTypes<TTypes, "query", PaginatedProcedureCapability<TTypes["input"], TCursor, TTypes["output"], TTypes["writesHeaders"]>, PageRequest<TTypes["input"], TCursor>, Page<TTypes["output"], TCursor>>>;
    private finish;
}
export declare const rpc: ContractFactory<unknown> & {
    context: <TRootContext>() => ContractFactory<TRootContext>;
};

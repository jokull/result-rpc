import {
  type InputOf,
  type AnyWireCodec,
  type AnyLayer,
  type AnyModel,
  type AnyProcedure,
  type AnyProcedureContract,
  type AnyRouter,
  type AnyRouterContract,
  type AnyTaggedError,
  type ClientBoundaryError,
  type ModelKeyInput,
  type ProcedureError,
  type ErrorUnion,
  type ErrorDefinition,
  type ErrorVisibility,
  type ServerBadRequest,
  type Result,
  TaggedError,
  ServerInternal,
  err,
  error,
  ok,
  wire,
  type WireCodec,
  type WireValue,
  matchError,
  isTaggedError,
} from "../src/index.js";
import {
  createBrowserClient,
  type BrowserProcedureClient,
  type ClientPaginationTypes,
  type ClientProcedureError,
  type ClientProcedureInput,
  type ClientProcedureKind,
  type ClientProcedureOutput,
  type ClientProcedurePagination,
  type ClientProcedureSource,
  type ClientErrors,
  type TransportResponse,
} from "../src/client/index.js";
import { createServerClient, serverRpc } from "../src/server/index.js";
import { defineModel, type ModelProjection, type ModelValue } from "../src/model.js";
import {
  createResultRpcReact,
  type MutationStateOf,
  type MutationOptions,
  type PaginatedClientCursor,
  type PaginatedClientItem,
  type PaginatedClientListInput,
  type PaginatedState,
  type PaginatedStateOf,
  type QueryState,
  type QueryOptions,
  type QueryStateOf,
  ResultSuspense,
  type ResultSuspenseProps,
  type SubscriptionState,
  type SubscriptionOptions,
  useResultClient,
  useResultMutation,
  useResultPaginatedQuery,
  useResultQuery,
  useResultSubscription,
  useResultSuspenseQuery,
} from "../src/react/index.js";

const resultSuspenseProps: ResultSuspenseProps = {
  fallback: null,
  resetKey: "document-route",
};
ResultSuspense(resultSuspenseProps);
import { createQueryRuntime } from "../src/query/runtime.js";
// @ts-expect-error the React entry is `use client`; runtime construction belongs to result-rpc/query
import { createQueryRuntime as unsafeReactRuntime } from "../src/react/index.js";
void unsafeReactRuntime;
import {
  rpc,
  type RouterContext,
  type RouterErrors,
  type RouterInputs,
  type RouterOutputs,
  type RouterRecordOf,
  type RouterTypesOf,
  type RpcFactoryContext,
} from "../src/index.js";
import {
  defectErrors,
  defineErrors,
  defineLayer,
  type LayerErrors,
  type LayerValue,
  defineService,
  type AnyServiceDefinition,
  type ServiceTypesOf,
  errorCatalog,
  resolveServices,
  staleErrors,
  transportErrors,
} from "../src/index.js";
import {
  defineShell,
  layerShell,
  type ClaimedBy,
  type ClaimedErrorsBy,
  type AnyLayerShell,
  type AnyShell,
  type SubtractClaimedErrors,
  type ValueOf,
} from "../src/react/index.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type _TransportResponseRequiresContractEvidence = Assert<
  Equal<TransportResponse["contract"], string | null>
>;

const Missing = error({
  tag: "type/missing",
  data: wire.object({ id: wire.string }),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
});

const Conflict = error({
  tag: "type/conflict",
  data: wire.object({ id: wire.string }),
  httpStatus: 409,
  retry: "never",
  visibility: "public",
});

const OtherMissing = error({
  tag: "type/missing",
  data: wire.object({ count: wire.number }),
});

// A deliberately dangerous near-match: plain `Exclude` would consider the
// procedure's `{ id }` payload assignable to this optional superset.
const WiderMissing = error({
  tag: "type/missing",
  data: wire.object({ id: wire.string, note: wire.optional(wire.string) }),
});

// Callback-bearing options are contravariant: a handler prepared for every
// tagged error is safe where one specific error is expected, never vice versa.
declare const broadQueryOptions: QueryOptions<AnyTaggedError>;
const narrowQueryOptions: QueryOptions<ReturnType<typeof Missing>> = broadQueryOptions;
declare const onlyMissingQueryOptions: QueryOptions<ReturnType<typeof Missing>>;
// @ts-expect-error A Missing-only callback cannot receive every tagged error.
const unsafeBroadQueryOptions: QueryOptions<AnyTaggedError> = onlyMissingQueryOptions;
void narrowQueryOptions;
void unsafeBroadQueryOptions;

declare const broadMutationOptions: MutationOptions<unknown, unknown, AnyTaggedError>;
const narrowMutationOptions: MutationOptions<
  { readonly id: string },
  string,
  ReturnType<typeof Missing>
> = broadMutationOptions;
void narrowMutationOptions;

declare const broadSubscriptionOptions: SubscriptionOptions<AnyTaggedError>;
const narrowSubscriptionOptions: SubscriptionOptions<ReturnType<typeof Missing>> =
  broadSubscriptionOptions;
void narrowSubscriptionOptions;

declare const narrowSubscriptionState: SubscriptionState<
  { readonly id: string },
  ReturnType<typeof Missing>
>;
const broadSubscriptionState: SubscriptionState<object, AnyTaggedError> = narrowSubscriptionState;
void broadSubscriptionState;

const DefaultPublic = error({
  tag: "type/default-public",
  data: wire.object({}),
});
DefaultPublic();
DefaultPublic({});
// @ts-expect-error Data-free errors accept an empty object, never a primitive.
DefaultPublic(123);
// @ts-expect-error Data-free errors reject undeclared fields.
DefaultPublic({ unexpected: true });

const EmptyCodec = wire.object({});
EmptyCodec.encode({});
// @ts-expect-error An empty object codec does not accept primitives.
EmptyCodec.encode(123);
// @ts-expect-error An empty object codec rejects undeclared fields statically too.
EmptyCodec.encode({ unexpected: true });

const stringOnlyCodec: WireCodec<string, string> = wire.string;
// @ts-expect-error Codec inputs are invariant: a string codec cannot claim to encode numbers.
const unsafelyWidenedCodec: WireCodec<string | number, string> = stringOnlyCodec;
void unsafelyWidenedCodec;
const erasedStringCodec: AnyWireCodec = wire.string;
// @ts-expect-error An erased codec registry cannot feed arbitrary input into a specific encoder.
erasedStringCodec.encode("value");
export type _ErasedCodecDoesNotLeakInput = Assert<Equal<InputOf<AnyWireCodec>, never>>;
const structuralSchema: string = wire.object({ id: wire.string }).schema;
void structuralSchema;
wire.serializable((value): value is string => typeof value === "string", {
  id: "public/string/v1",
});
// @ts-expect-error External guards require a stable contract schema identity.
wire.serializable((value): value is string => typeof value === "string");

declare const stringInputDefinition: ErrorDefinition<"variance/input", string, string, "public">;
declare const wideInputDefinition: ErrorDefinition<
  "variance/input",
  string | number,
  string,
  "public"
>;
// @ts-expect-error A definition that accepts only strings cannot claim to accept numbers.
const unsafelyWidenedDefinitionInput: typeof wideInputDefinition = stringInputDefinition;
// @ts-expect-error Decode makes definition input invariant, not merely contravariant.
const unsafelyNarrowedDefinitionInput: typeof stringInputDefinition = wideInputDefinition;
void unsafelyWidenedDefinitionInput;
void unsafelyNarrowedDefinitionInput;

declare const narrowDataDefinition: ErrorDefinition<"variance/data", string, string, "public">;
declare const wideDataDefinition: ErrorDefinition<
  "variance/data",
  string,
  string | number,
  "public"
>;
const covariantDefinitionData: typeof wideDataDefinition = narrowDataDefinition;
// @ts-expect-error Encoded error data cannot be narrowed from string | number to string.
const unsafelyNarrowedDefinitionData: typeof narrowDataDefinition = wideDataDefinition;
void covariantDefinitionData;
void unsafelyNarrowedDefinitionData;

declare const publicTagged: TaggedError<"variance/visibility", string, "public">;
declare const anyVisibilityTagged: TaggedError<"variance/visibility", WireValue, ErrorVisibility>;
const covariantTaggedError: typeof anyVisibilityTagged = publicTagged;
// @ts-expect-error An unknown visibility cannot be narrowed to public.
const unsafelyPublicTaggedError: typeof publicTagged = anyVisibilityTagged;
void covariantTaggedError;
void unsafelyPublicTaggedError;

const PrivateFailure = error({
  tag: "type/private-failure",
  data: wire.object({ detail: wire.string }),
  visibility: "private",
});

const visibilityErrors = defineErrors("visibility", {
  publicByDefault: {},
  privateDetail: {
    data: wire.object({ detail: wire.string }),
    visibility: "private",
  },
});

export type _OmittedVisibilityIsPublic = Assert<
  Equal<typeof DefaultPublic.policy.visibility, "public">
>;
export type _ExplicitPrivateVisibilityIsPreserved = Assert<
  Equal<typeof PrivateFailure.policy.visibility, "private">
>;
export type _PublicHttpStatusIsOptional = Assert<
  Equal<typeof DefaultPublic.policy.httpStatus, number | undefined>
>;
export type _PrivateHttpStatusDoesNotExist = Assert<
  Equal<typeof PrivateFailure.policy.httpStatus, undefined>
>;
export type _NamespacedDefaultVisibilityIsPublic = Assert<
  Equal<typeof visibilityErrors.publicByDefault.policy.visibility, "public">
>;
export type _NamespacedPrivateVisibilityIsPreserved = Assert<
  Equal<typeof visibilityErrors.privateDetail.policy.visibility, "private">
>;

// @ts-expect-error Private errors have no HTTP projection.
error({ tag: "type/private-with-status", visibility: "private", httpStatus: 500 });
// @ts-expect-error Namespaced private errors have no HTTP projection either.
defineErrors("invalid-private", { failure: { visibility: "private", httpStatus: 500 } });

// @ts-expect-error A shape-compatible object is not a reified TaggedError.
err({ _tag: "type/missing", data: { id: "x" } });

export type _DeclaredErrorsAreErrorInstances = Assert<
  ReturnType<typeof Missing> extends Error ? true : false
>;
TaggedError.is(Missing({ id: "x" }));
isTaggedError(Missing({ id: "x" }));

interface Context {
  readonly authenticated: boolean;
}

const contractR = rpc.context<Context>();
const r = serverRpc.context<Context>();
export type _ContractFactoryCarriesContext = Assert<
  Equal<RpcFactoryContext<typeof contractR>, Context>
>;
export type _ServerFactoryCarriesContext = Assert<Equal<RpcFactoryContext<typeof r>, Context>>;

// Procedure builders expose only legal terminal states.
// @ts-expect-error A terminal procedure requires an output codec.
contractR.procedure().query();
// @ts-expect-error A terminal executable procedure requires an output codec.
r.procedure().mutation(() => ok("missing output"));
// @ts-expect-error Header-writing procedures cannot become subscriptions.
contractR.procedure().headers().output(wire.string).subscription();
// @ts-expect-error Mutation declarations narrow the builder to mutation.
contractR
  .procedure()
  .output(wire.string)
  .affects(contractR.procedure().output(wire.string).query())
  .query();

r.procedure().errors({ Missing }).errors({ Missing });
// @ts-expect-error One definition-map key cannot identify two different errors.
r.procedure().errors({ Missing }).errors({ Missing: Conflict });
// @ts-expect-error One error tag cannot carry two incompatible data definitions.
r.procedure().errors({ Missing }).errors({ OtherMissing });

contractR.procedure().errors({ DefaultPublic });
// @ts-expect-error Private errors are server-only composition currency, not RPC contract errors.
contractR.procedure().errors({ PrivateFailure });
// @ts-expect-error Middleware errors can cross the wire and must therefore be public.
r.middleware().errors({ PrivateFailure });
// @ts-expect-error A map containing a private definition cannot become an RPC error map.
contractR.procedure().errors(visibilityErrors);

const procedure = r
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ Missing })
  .query(({ input, errors }) =>
    input.id === "missing" ? err(errors.Missing({ id: input.id })) : ok(input.id),
  );

r.procedure()
  .input(wire.object({}))
  .output(wire.string)
  .errors({ Missing })
  // @ts-expect-error Undeclared errors cannot widen the handler contract.
  .query(() => err(Conflict({ id: "x" })));

r.middleware()
  .errors({ Missing })
  // @ts-expect-error Middleware cannot manufacture an undeclared tagged error.
  .use(() => err(Conflict({ id: "x" })));

r.procedure()
  .input(wire.object({}))
  .output(wire.string)
  // @ts-expect-error Raw Error is not part of the tagged recoverable algebra.
  .query(() => err(new Error("not recoverable")));

declare const closedError: ReturnType<typeof Missing> | ReturnType<typeof Conflict>;
matchError(closedError, {
  "type/missing": () => "missing",
  "type/conflict": () => "conflict",
});
// @ts-expect-error Exhaustive matching requires every tag in the union.
matchError(closedError, { "type/missing": () => "missing" });

// @ts-expect-error Functions are not supported by the transparent wire serializer.
const unsafeCodec: WireCodec<Date, () => void> = {
  kind: "function",
  encode: () => ({ ok: true, value: () => undefined }),
  decode: (value) => ({ ok: true, value: value as Date }),
};
void unsafeCodec;

const optionalCodec = wire.object({
  required: wire.string,
  optional: wire.optional(wire.number),
  labels: wire.record(wire.string),
});
optionalCodec.encode({ required: "yes", labels: {} });
optionalCodec.encode({ required: "yes", optional: 1, labels: { region: "north" } });
// @ts-expect-error Required object fields remain required.
optionalCodec.encode({ optional: 1, labels: {} });

const router = r.router({ example: { procedure } });
const contractProcedure = contractR
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ Missing })
  .query();
const mutationContract = contractR
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ Missing })
  .mutation();
const subscriptionContract = contractR
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ Missing })
  .subscription();
const paginatedContract = contractR
  .procedure()
  .input(wire.object({ q: wire.string }))
  .output(wire.string)
  .errors({ Missing })
  .paginate({ cursor: wire.string });
const alternateQueryContract = contractR
  .procedure()
  .input(wire.object({ page: wire.number }))
  .output(wire.number)
  .query();
const alternateMutationContract = contractR
  .procedure()
  .input(wire.object({ count: wire.number }))
  .output(wire.number)
  .mutation();
const alternateSubscriptionContract = contractR
  .procedure()
  .input(wire.object({ channel: wire.string }))
  .output(wire.number)
  .subscription();
const alternatePaginatedContract = contractR
  .procedure()
  .input(wire.object({ pageSize: wire.number }))
  .output(wire.number)
  .paginate({ cursor: wire.number });
const paginationLookalikeContract = contractR
  .procedure()
  .input(
    wire.object({
      list: wire.object({ q: wire.string }),
      cursor: wire.union([wire.string, wire.null]),
    }),
  )
  .output(
    wire.object({
      items: wire.array(wire.string),
      nextCursor: wire.union([wire.string, wire.null]),
    }),
  )
  .query();
contractR
  .procedure()
  .input(wire.object({ q: wire.string }))
  .output(wire.string)
  .affects(paginatedContract, (input) => ({ q: input.q }))
  .mutation();
const inputBoundByAffects = contractR
  .procedure()
  .input(wire.object({ q: wire.string }))
  .output(wire.string)
  .affects(paginatedContract, (input) => ({ q: input.q }));
// @ts-expect-error Cache mappers stay bound to the input codec they were declared against.
inputBoundByAffects.input(wire.object({ id: wire.string }));
contractR
  .procedure()
  .input(wire.object({ q: wire.string }))
  .output(wire.string)
  // @ts-expect-error Paginated invalidation maps list identity, not the page envelope.
  .affects(paginatedContract, (input) => ({ list: { q: input.q }, cursor: null }))
  .mutation();
const zeroInputContract = contractR.procedure().output(wire.string).query();
const zeroInputSubscriptionContract = contractR.procedure().output(wire.string).subscription();
const missingMiddleware = r
  .middleware()
  .errors({ Missing })
  .use(({ next }) => next({ context: {} }));
const contractWithoutMissing = contractR.procedure().output(wire.string).query();
// @ts-expect-error Contract-first middleware cannot add an undeclared recoverable error.
r.implement(contractWithoutMissing).use(missingMiddleware);
r.implement(contractR.procedure().output(wire.string).errors({ Missing }).query()).use(
  missingMiddleware,
);
const headerMiddleware = r
  .middleware()
  .headers()
  .use(({ next }) => next({ context: {} }));
// @ts-expect-error Header-writing middleware requires `.headers()` on the shared contract.
r.implement(contractWithoutMissing).use(headerMiddleware);
r.implement(contractR.procedure().headers().output(wire.string).query()).use(headerMiddleware);
r.implement(contractR.procedure().headers().output(wire.string).query()).handler(({ context }) => {
  context.headers.append("set-cookie", "session=typed");
  return ok("ok");
});
declare const zeroInputClient: BrowserProcedureClient<typeof zeroInputContract>;
declare const zeroInputSubscriptionClient: BrowserProcedureClient<
  typeof zeroInputSubscriptionContract
>;
zeroInputClient();
zeroInputClient({});
// @ts-expect-error Zero-input procedures reject primitives.
zeroInputClient(123);
// @ts-expect-error Zero-input procedures reject undeclared fields.
zeroInputClient({ unexpected: true });
zeroInputSubscriptionClient();
zeroInputSubscriptionClient({});
// @ts-expect-error Zero-input subscriptions reject primitives too.
zeroInputSubscriptionClient(123);
// @ts-expect-error Zero-input subscriptions reject undeclared fields too.
zeroInputSubscriptionClient({ unexpected: true });
const contract = contractR.contract({
  example: {
    procedure: contractProcedure,
    mutation: mutationContract,
    subscription: subscriptionContract,
    paginated: paginatedContract,
    paginationLookalike: paginationLookalikeContract,
  },
});
export type _ExecutableRouterCarriesRootContext = Assert<
  Equal<RouterContext<typeof router>, Context>
>;
export type _ExecutableRouterCarriesExactRecord = Assert<
  Equal<RouterRecordOf<typeof router>, typeof router.record>
>;
export type _ContractRouterCarriesRootContext = Assert<
  Equal<RouterContext<typeof contract>, Context>
>;
export type _ContractRouterCarriesExactRecord = Assert<
  Equal<RouterTypesOf<typeof contract>["record"], typeof contract.record>
>;
const client = createBrowserClient({
  contract,
  transport: { request: async () => ({ ok: false, reason: "network" }) },
});
const serverClient = createServerClient(router, { context: { authenticated: true } });

type CallResult = Awaited<ReturnType<typeof client.example.procedure>>;
type CallError = CallResult extends Result<unknown, infer E> ? E : never;
type ExpectedError =
  | ReturnType<typeof Missing>
  | ReturnType<typeof ServerInternal>
  | ServerBadRequest
  | ClientBoundaryError;

export type _ClientErrorIsClosed = Assert<Equal<CallError, ExpectedError>>;
export type _ProcedureCarrierRetainsInput = Assert<
  Equal<Flat<ClientProcedureInput<typeof client.example.procedure>>, { readonly id: string }>
>;
export type _ProcedureCarrierRetainsOutput = Assert<
  Equal<ClientProcedureOutput<typeof client.example.procedure>, string>
>;
export type _ProcedureCarrierRetainsError = Assert<
  Equal<ClientProcedureError<typeof client.example.procedure>, ExpectedError>
>;
export type _ProcedureCarrierRetainsKind = Assert<
  Equal<ClientProcedureKind<typeof client.example.procedure>, "query">
>;
export type _ProcedureCarrierRetainsItsContract = Assert<
  Equal<ClientProcedureSource<typeof client.example.procedure>, typeof contractProcedure>
>;
export type _ProcedureCarrierDistinguishesPagination = Assert<
  Equal<ClientProcedurePagination<typeof client.example.procedure>, never>
>;
export type _PaginatedProcedureCarriesCorrelatedTypes = Assert<
  ClientProcedurePagination<typeof client.example.paginated> extends ClientPaginationTypes<
    unknown,
    unknown,
    unknown
  >
    ? true
    : false
>;
export type _PaginationRequiresAnExplicitCapability = Assert<
  Equal<ClientProcedurePagination<typeof client.example.paginationLookalike>, never>
>;
export type _PaginatedListInputFlowsFromTheDescriptor = Assert<
  Equal<Flat<PaginatedClientListInput<typeof client.example.paginated>>, { readonly q: string }>
>;
export type _PaginatedCursorFlowsFromTheDescriptor = Assert<
  Equal<PaginatedClientCursor<typeof client.example.paginated>, string>
>;
export type _PaginatedItemFlowsFromTheDescriptor = Assert<
  Equal<PaginatedClientItem<typeof client.example.paginated>, string>
>;
export type _ClientCarriesTheWholePublicErrorUnion = Assert<
  Equal<ClientErrors<typeof client>, ExpectedError>
>;
export type _EveryClientErrorIsPublic = Assert<
  Equal<ClientErrors<typeof client>["visibility"], "public">
>;
type ServerCallResult = Awaited<ReturnType<typeof serverClient.example.procedure>>;
type ServerCallError = ServerCallResult extends Result<unknown, infer E> ? E : never;
type ExpectedServerError =
  | ReturnType<typeof Missing>
  | ReturnType<typeof ServerInternal>
  | ServerBadRequest;
export type _ServerClientHasOnlyReachableErrors = Assert<
  Equal<ServerCallError, ExpectedServerError>
>;
export type _ServerRegistryCarriesTheNarrowUnion = Assert<
  Equal<ClientErrors<typeof serverClient>, ExpectedServerError>
>;

declare const unknownFailure: unknown;
if (client.$errors.is(unknownFailure)) {
  const appFailure: ExpectedError = unknownFailure;
  void appFailure;
}

// @ts-expect-error Input is inferred from the procedure codec.
void client.example.procedure({ id: 123 });
void client.example.procedure({ id: "valid" });

const runtime = createQueryRuntime({ client });
declare const alternateQueryClient: BrowserProcedureClient<typeof alternateQueryContract>;
declare const alternateMutationClient: BrowserProcedureClient<typeof alternateMutationContract>;
declare const alternateSubscriptionClient: BrowserProcedureClient<
  typeof alternateSubscriptionContract
>;
declare const alternatePaginatedClient: BrowserProcedureClient<typeof alternatePaginatedContract>;
declare const selectedQuery: typeof client.example.procedure | typeof alternateQueryClient;
declare const selectedMutation: typeof client.example.mutation | typeof alternateMutationClient;
declare const selectedSubscription:
  | typeof client.example.subscription
  | typeof alternateSubscriptionClient;
declare const selectedPaginated: typeof client.example.paginated | typeof alternatePaginatedClient;
// @ts-expect-error A procedure union must be narrowed before its associated input can be supplied.
runtime.observe(selectedQuery, { id: "valid" });
// @ts-expect-error Cache operations preserve the same procedure/input correlation.
runtime.cache.get(selectedQuery, { id: "valid" });
// @ts-expect-error A union mutation would expose an independently unioned mutate input.
runtime.mutation(selectedMutation);
// @ts-expect-error Subscription procedure and input remain one associated fact.
runtime.subscription(selectedSubscription, { id: "valid" });
// @ts-expect-error Paginated procedure and list input remain one associated fact.
runtime.observePaginated(selectedPaginated, { q: "valid" });
// @ts-expect-error React query hooks reject an unresolved procedure union too.
useResultQuery(selectedQuery, { id: "valid" });
// @ts-expect-error Suspense uses the same procedure/input algebra.
useResultSuspenseQuery(selectedQuery, { id: "valid" });
// @ts-expect-error A mutation hook cannot expose a mutate function over unrelated inputs.
useResultMutation(selectedMutation);
// @ts-expect-error Subscription hooks preserve procedure/input correlation.
useResultSubscription(selectedSubscription, { id: "valid" });
// @ts-expect-error Paginated hooks preserve procedure/list-input correlation.
useResultPaginatedQuery(selectedPaginated, { q: "valid" });
const ProjectionUser = defineModel("projection-user", {
  key: "id",
  shape: {
    id: wire.string,
    name: wire.string,
    secret: wire.string,
  },
});
runtime.cache.updateEntity(ProjectionUser, "u1", (current) => {
  const identity: string = current.id;
  void identity;
  // @ts-expect-error A cached projection does not guarantee non-key model fields.
  current.secret.toUpperCase();
  return { name: "safe without reading an absent field" };
});
// @ts-expect-error Projection updates cannot invent fields outside the canonical model.
runtime.cache.updateEntity(ProjectionUser, "u1", () => ({ invented: true }));
export type _RuntimeRetainsItsExactClient = Assert<Equal<typeof runtime.client, typeof client>>;
// @ts-expect-error Mutation procedures cannot be used as cache keys.
runtime.cache.get(client.example.mutation, { id: "valid" });
const observer = runtime.observe(client.example.procedure, { id: "valid" });
runtime.observe(client.example.paginationLookalike, {
  list: { q: "valid" },
  cursor: null,
});
runtime.observePaginated(client.example.paginated, { q: "valid" });
// @ts-expect-error A structural page lookalike is still a unary query.
runtime.observePaginated(client.example.paginationLookalike, { q: "valid" });
// @ts-expect-error A paginated query cannot enter the unary observer API.
runtime.observe(client.example.paginated, { list: { q: "valid" }, cursor: null });
type ObservedState = ReturnType<typeof observer.getCurrentState>;
type ExpectedState = QueryState<string, ExpectedError>;
export type _QueryPreservesClosedError = Assert<Equal<ObservedState, ExpectedState>>;
export type _QueryStateAliasPreservesTheProcedure = Assert<
  Equal<QueryStateOf<typeof client.example.procedure>, ExpectedState>
>;
export type _MutationStateAliasPreservesTheProcedure = Assert<
  Equal<
    Extract<
      MutationStateOf<typeof client.example.mutation>,
      { readonly state: "failure" }
    >["error"],
    ExpectedError
  >
>;
export type _PaginatedStateAliasPreservesTheProcedure = Assert<
  Equal<PaginatedStateOf<typeof client.example.paginated>, PaginatedState<string, ExpectedError>>
>;
export type _ProjectedRefetchDoesNotPromiseANarrowedResult = Assert<
  Equal<ReturnType<ObservedState["refetch"]>, Promise<void>>
>;

const scopedReact = createResultRpcReact<typeof client>();
export type _ScopedHookReturnsItsBoundClient = Assert<
  Equal<ReturnType<typeof scopedReact.useResultClient>, typeof client>
>;
scopedReact.ResultRpcProvider({ client });
// @ts-expect-error A scoped provider cannot silently accept another client shape.
scopedReact.ResultRpcProvider({ client: {} });
// @ts-expect-error The global hook is registration-driven, never caller-selected.
// oxlint-disable-next-line react-hooks/rules-of-hooks -- compile-time negative API proof
useResultClient<typeof client>();

// @ts-expect-error Query procedures cannot be used as mutations.
runtime.mutation(client.example.procedure);
// @ts-expect-error Mutation procedures cannot be observed as queries.
runtime.observe(client.example.mutation, { id: "valid" });
// @ts-expect-error Subscriptions have their own observable lifecycle.
runtime.observe(client.example.subscription, { id: "valid" });

const optimisticContext = runtime.mutation(client.example.mutation, {
  optimistic: () => ({ rollback: () => undefined }),
  onFailure: (_error, _input, context) => context?.rollback(),
});
void optimisticContext;

const subscription = runtime.subscription(client.example.subscription, { id: "valid" });
type SubscriptionResult = ReturnType<typeof subscription.getCurrentState>["result"];
export type _SubscriptionResultIsClosed = Assert<
  Equal<Exclude<SubscriptionResult, undefined>, Result<string, ExpectedError>>
>;

// --- Shell narrowing -------------------------------------------------------

const TransportShell = defineShell({
  name: "transport",
  claims: transportErrors,
  effect: "pause",
});

const DefectShell = defineShell({
  name: "defect",
  from: TransportShell,
  claims: defectErrors,
  effect: "escalate",
});

const StaleShell = defineShell({
  name: "stale",
  from: DefectShell,
  claims: staleErrors,
});

const AuthShell = defineShell({
  name: "auth",
  from: StaleShell,
  claims: { Conflict },
  provide: (props: { readonly userId: string }) => ({ userId: props.userId }),
});

// @ts-expect-error Shell subtraction cannot make an unresolved query/input pair safe.
AuthShell.useQuery(selectedQuery, { id: "valid" });
// @ts-expect-error Suspense shell hooks use the same narrowed procedure boundary.
AuthShell.useSuspenseQuery(selectedQuery, { id: "valid" });
// @ts-expect-error Shell mutation hooks reject unrelated mutate-input unions.
AuthShell.useMutation(selectedMutation);
// @ts-expect-error Shell subscription hooks preserve procedure/input correlation.
AuthShell.useSubscription(selectedSubscription, { id: "valid" });
// @ts-expect-error Shell pagination preserves procedure/list-input correlation.
AuthShell.usePaginatedQuery(selectedPaginated, { q: "valid" });

// @ts-expect-error A non-void shell value must come from a real provider callback.
defineShell<typeof transportErrors, Record<never, never>, string>({
  name: "fictional-value",
  claims: transportErrors,
});

// @ts-expect-error A shell whose associated parent is concrete must name that parent.
defineShell<typeof defectErrors, Record<never, never>, void, typeof TransportShell>({
  name: "missing-parent",
  claims: defectErrors,
  provide: () => undefined,
});

const IncompatibleMissingShell = defineShell({
  name: "incompatible-missing",
  claims: { OtherMissing },
});
declare const useIncompatibleMissingQuery: typeof IncompatibleMissingShell.useQuery;
type IncompatibleMissingState = ReturnType<
  typeof useIncompatibleMissingQuery<typeof client.example.procedure>
>;
type IncompatibleMissingError = Extract<
  IncompatibleMissingState,
  { readonly state: "failure" }
>["error"];
export type _ShellDoesNotSubtractAnIncompatibleSameTagDefinition = Assert<
  Equal<IncompatibleMissingError, ExpectedError>
>;

const WiderMissingShell = defineShell({
  name: "wider-missing",
  claims: { WiderMissing },
});
declare const useWiderMissingQuery: typeof WiderMissingShell.useQuery;
type WiderMissingState = ReturnType<typeof useWiderMissingQuery<typeof client.example.procedure>>;
type WiderMissingError = Extract<WiderMissingState, { readonly state: "failure" }>["error"];
export type _ShellRequiresAnExactSignatureNotOneWayAssignability = Assert<
  Equal<WiderMissingError, ExpectedError>
>;

export type _SubtractClaimedErrorsDistributesWithoutWidening = Assert<
  Equal<
    SubtractClaimedErrors<
      ReturnType<typeof Missing> | ReturnType<typeof Conflict>,
      ReturnType<typeof Missing>
    >,
    ReturnType<typeof Conflict>
  >
>;

type ExpectedShellClaims =
  | ErrorUnion<typeof transportErrors>
  | ErrorUnion<typeof defectErrors>
  | ErrorUnion<typeof staleErrors>
  | ReturnType<typeof Conflict>;
export type _ShellChainRetainsTheExactClaimedUnion = Assert<
  Equal<ClaimedErrorsBy<typeof AuthShell>, ExpectedShellClaims>
>;
declare const unknownShellFailure: unknown;
if (AuthShell.$errors.is(unknownShellFailure)) {
  const claimedFailure: ExpectedShellClaims = unknownShellFailure;
  void claimedFailure;
  // @ts-expect-error The domain error is not owned by this shell chain.
  const unclaimedFailure: ReturnType<typeof Missing> = unknownShellFailure;
  void unclaimedFailure;
}

declare const useTransportQuery: typeof TransportShell.useQuery;
type TransportState = ReturnType<typeof useTransportQuery<typeof client.example.procedure>>;
type TransportError = Extract<TransportState, { readonly state: "failure" }>["error"];
export type _OuterShellSubtractsOnlyItsOwnDefinitions = Assert<
  Equal<TransportError, Exclude<ExpectedError, ErrorUnion<typeof transportErrors>>>
>;

declare const useDefectQuery: typeof DefectShell.useQuery;
type DefectState = ReturnType<typeof useDefectQuery<typeof client.example.procedure>>;
type DefectError = Extract<DefectState, { readonly state: "failure" }>["error"];
export type _NestedShellAccumulatesItsParentDefinitions = Assert<
  Equal<
    DefectError,
    Exclude<ExpectedError, ErrorUnion<typeof transportErrors> | ErrorUnion<typeof defectErrors>>
  >
>;

declare const useStaleQuery: typeof StaleShell.useQuery;
type StaleState = ReturnType<typeof useStaleQuery<typeof client.example.procedure>>;
type StaleError = Extract<StaleState, { readonly state: "failure" }>["error"];
export type _DeepShellPreservesTheUntouchedDomainMember = Assert<
  Equal<StaleError, ReturnType<typeof Missing>>
>;

declare const useShellQuery: typeof AuthShell.useQuery;
type ShellState = ReturnType<typeof useShellQuery<typeof client.example.procedure>>;
type ShellError = Extract<ShellState, { readonly state: "failure" }>["error"];

// Every framework tag is absorbed by an enclosing layer; only the domain error
// the procedure declares survives into the component.
export type _ShellSubtractsExactlyTheClaimedTags = Assert<
  Equal<ShellError, ReturnType<typeof Missing>>
>;

declare const useShellSuspenseQuery: typeof AuthShell.useSuspenseQuery;
type ShellSuspenseState = ReturnType<typeof useShellSuspenseQuery<typeof client.example.procedure>>;
type ShellSuspenseError = Extract<ShellSuspenseState, { readonly state: "failure" }>["error"];
export type _SuspenseShellSubtractsExactlyTheClaimedErrors = Assert<
  Equal<ShellSuspenseError, ReturnType<typeof Missing>>
>;

// oxlint-disable-next-line react-hooks/rules-of-hooks -- compile-time callback inference proof
const shellMutation = AuthShell.useMutation(client.example.mutation, {
  // Mutation lifecycle callbacks run in the query runtime before React claims
  // the outcome, so they truthfully retain the complete procedure union.
  onFailure: (failure) => {
    const fullFailure: ExpectedError = failure;
    void fullFailure;
  },
  onSettled: (result) => {
    if (!result.ok) {
      const fullFailure: ExpectedError = result.error;
      void fullFailure;
    }
  },
});
type ShellMutationError = Extract<typeof shellMutation, { readonly state: "failure" }>["error"];
export type _ShellMutationStateSubtractsClaimedTags = Assert<
  Equal<ShellMutationError, ReturnType<typeof Missing>>
>;

declare const useShellPaginated: typeof AuthShell.usePaginatedQuery;
type ShellPaginatedState = ReturnType<typeof useShellPaginated<typeof client.example.paginated>>;
type ShellPaginatedError = Extract<ShellPaginatedState, { readonly state: "failure" }>["error"];
export type _PaginatedShellSubtractsExactlyTheClaimedTags = Assert<
  Equal<ShellPaginatedState, PaginatedState<string, ReturnType<typeof Missing>>>
>;
export type _PaginatedShellErrorIsNarrow = Assert<
  Equal<ShellPaginatedError, ReturnType<typeof Missing>>
>;

declare const useShellSubscription: typeof AuthShell.useSubscription;
type ShellSubscriptionState = ReturnType<
  typeof useShellSubscription<typeof client.example.subscription>
>;
type ShellSubscriptionError =
  NonNullable<ShellSubscriptionState["result"]> extends Result<unknown, infer TError>
    ? TError
    : never;
export type _SubscriptionShellSubtractsExactlyTheClaimedErrors = Assert<
  Equal<ShellSubscriptionState, SubscriptionState<string, ReturnType<typeof Missing>>>
>;
export type _SubscriptionShellErrorIsNarrow = Assert<
  Equal<ShellSubscriptionError, ReturnType<typeof Missing>>
>;

declare const useZeroInputShellSubscription: typeof AuthShell.useSubscription;
// oxlint-disable-next-line react-hooks/rules-of-hooks -- compile-time arity proof
useZeroInputShellSubscription(zeroInputSubscriptionClient);
// @ts-expect-error A required-input subscription remains required through a shell.
// oxlint-disable-next-line react-hooks/rules-of-hooks -- compile-time negative arity proof
useZeroInputShellSubscription(client.example.subscription);

// The chain accumulates: the innermost layer sees its parents' claims too.
export type _ChainAccumulates = Assert<
  Equal<ClaimedBy<typeof AuthShell>, ClaimedBy<typeof StaleShell> | "type/conflict">
>;

// The guaranteed value is not optional inside the layer.
export type _ProvidedValueIsGuaranteed = Assert<
  Equal<ValueOf<typeof AuthShell>, { userId: string }>
>;

// --- Layer factory ---------------------------------------------------------

const ViewerCodec = wire.object({ id: wire.string });
type Viewer = InputOf<typeof ViewerCodec>;

const SessionLayer = defineLayer({
  name: "session",
  key: "viewer",
  provides: ViewerCodec,
  errors: { Conflict },
});

defineLayer({
  name: "private-layer",
  key: "privateValue",
  provides: wire.string,
  // @ts-expect-error Layer failures cross the RPC boundary and must be public.
  errors: { PrivateFailure },
});

const sessionMiddleware = SessionLayer.middleware(r, ({ context, errors }) =>
  context.authenticated ? ok({ id: "u_1" }) : err(errors.Conflict({ id: "u_1" })),
);

// The middleware adds the layer value to context under the declared key.
const layered = r
  .procedure()
  .input(wire.object({}))
  .output(wire.string)
  .use(sessionMiddleware)
  .query(({ context }) => ok(context.viewer.id));
void layered;

r.procedure()
  .input(wire.object({}))
  .output(wire.string)
  .use(sessionMiddleware)
  // @ts-expect-error The layer value is exactly the provides codec's type.
  .query(({ context }) => ok(context.viewer.missing));

// The context procedure's contract carries the layer value and union.
const sessionContract = SessionLayer.contract(contractR);
declare const sessionClientProcedure: BrowserProcedureClient<typeof sessionContract>;
SessionLayer.procedure(r, sessionMiddleware);
SessionLayer.implement(r, sessionContract, sessionMiddleware);

const tenantMiddleware = serverRpc
  .context<Context & { readonly tenantId: string }>()
  .middleware<{ readonly viewer: Viewer }>()
  .errors({ Conflict })
  .use(({ context, next }) => next({ context: { viewer: { id: context.tenantId } } }));
// @ts-expect-error The procedure's root context cannot satisfy this middleware's tenant input.
SessionLayer.implement(r, sessionContract, tenantMiddleware);

const wrongLayerValue = r
  .middleware<{ readonly viewer: number }>()
  .errors({ Conflict })
  .use(({ next }) => next({ context: { viewer: 42 } }));
// @ts-expect-error The final context must contain viewer with the layer's codec type.
SessionLayer.implement(r, sessionContract, wrongLayerValue);

const undeclaredLayerError = r
  .middleware<{ readonly viewer: Viewer }>()
  .errors({ Conflict, Missing })
  .use(({ next }) => next({ context: { viewer: { id: "u_1" } } }));
// @ts-expect-error Every composed middleware error must be declared by the contract.
SessionLayer.implement(r, sessionContract, undeclaredLayerError);

type SessionOutput = typeof sessionContract extends {
  readonly _def: { readonly output: WireCodec<infer T, any> };
}
  ? T
  : never;
export type _LayerContractOutput = Assert<Equal<SessionOutput, Viewer>>;

// The derived shell claims exactly the layer union plus its parents' claims.
const SessionShell = layerShell(SessionLayer, {
  from: DefectShell,
  procedure: sessionClientProcedure,
});
const ConflictOwnerShell = defineShell({
  name: "conflict-owner",
  from: DefectShell,
  claims: { Conflict },
});
// @ts-expect-error A layer cannot claim a definition already owned by its parent chain.
layerShell(SessionLayer, { from: ConflictOwnerShell, procedure: sessionClientProcedure });
// @ts-expect-error A layer shell must load the exact layer value from an empty-input procedure.
layerShell(SessionLayer, { from: DefectShell, procedure: client.example.procedure });
export type _LayerShellValue = Assert<Equal<ValueOf<typeof SessionShell>, Viewer>>;
export type _LayerShellHandled = Assert<
  Equal<ClaimedBy<typeof SessionShell>, ClaimedBy<typeof DefectShell> | "type/conflict">
>;

const ScopedSessionShell = scopedReact.layerShell(SessionLayer, {
  from: DefectShell,
  select: (selectedClient) => {
    const exactClient: typeof client = selectedClient;
    void exactClient;
    return sessionClientProcedure;
  },
});
const resolveSessionProcedure = ScopedSessionShell.resolveProcedure;
const expectedSessionResolver: (selectedClient: typeof client) => typeof sessionClientProcedure =
  resolveSessionProcedure;
void expectedSessionResolver;
const selectedProcedure = resolveSessionProcedure(client);
type _ResolverClientIsExact = Assert<
  Equal<Parameters<typeof resolveSessionProcedure>[0], typeof client>
>;
type _ResolverProcedureIsExact = Assert<
  Equal<typeof selectedProcedure, typeof sessionClientProcedure>
>;
void (0 as unknown as _ResolverClientIsExact);
void (0 as unknown as _ResolverProcedureIsExact);
// @ts-expect-error The resolver cannot be invoked with an unrelated client.
resolveSessionProcedure({});

// --- Optional layers and refinement ----------------------------------------

const MaybeViewerCodec = wire.union([ViewerCodec, wire.null]);
type MaybeViewer = InputOf<typeof MaybeViewerCodec>;

// optional: always establishes, may provide null
const CookieLayer = defineLayer({
  name: "cookie",
  key: "account",
  provides: MaybeViewerCodec,
  errors: {},
});

// required: narrows the same key, contributes the failure union
const AccountLayer = CookieLayer.require({
  name: "account",
  provides: ViewerCodec,
  errors: { Missing },
  refine: ({ value, errors }) =>
    value === null ? err(errors.Missing({ id: "anonymous" })) : ok(value),
});
export type _RefinedLayerValueIsExtractable = Assert<
  Equal<LayerValue<typeof AccountLayer>, Viewer>
>;
export type _RefinedLayerErrorsAreExtractable = Assert<
  Equal<LayerErrors<typeof AccountLayer>, { readonly Missing: typeof Missing }>
>;

const cookieMiddleware = CookieLayer.middleware(r, () => ok(null));
const accountMiddleware = AccountLayer.middleware(r, cookieMiddleware);
const cookieContract = CookieLayer.contract(contractR);
const accountContract = AccountLayer.contract(contractR);
declare const cookieClientProcedure: BrowserProcedureClient<typeof cookieContract>;
declare const accountClientProcedure: BrowserProcedureClient<typeof accountContract>;
AccountLayer.procedure(r, accountMiddleware);
AccountLayer.implement(r, accountContract, accountMiddleware);

// context grows and narrows monotonically through the chain
r.procedure()
  .input(wire.object({}))
  .output(wire.string)
  .use(cookieMiddleware)
  .query(({ context }) => {
    type _Nullable = Assert<Equal<typeof context.account, MaybeViewer>>;
    void (0 as unknown as _Nullable);
    return ok("");
  });

r.procedure()
  .input(wire.object({}))
  .output(wire.string)
  .use(accountMiddleware)
  .query(({ context }) => {
    type _Narrowed = Assert<Equal<typeof context.account, Viewer>>;
    void (0 as unknown as _Narrowed);
    return ok(context.account.id);
  });

// the refined layer's shell provides the narrowed value and claims its union
const CookieShell = layerShell(CookieLayer, {
  from: DefectShell,
  procedure: cookieClientProcedure,
});
const AccountShell = layerShell(AccountLayer, {
  from: CookieShell,
  procedure: accountClientProcedure,
});
export type _OptionalShellValue = Assert<Equal<ValueOf<typeof CookieShell>, MaybeViewer>>;
export type _RequiredShellValue = Assert<Equal<ValueOf<typeof AccountShell>, Viewer>>;
export type _RequiredShellHandled = Assert<
  Equal<ClaimedBy<typeof AccountShell>, ClaimedBy<typeof CookieShell> | "type/missing">
>;

// --- Middleware dependencies and services ----------------------------------

const contributesMissing = r
  .middleware()
  .errors({ Missing })
  .use(({ errors, next }) => {
    void errors.Missing;
    return next({ context: {} });
  });
const contributesConflict = r
  .middleware()
  .errors({ Conflict })
  .after(contributesMissing)
  .use(({ errors, next }) => {
    void errors.Conflict;
    // @ts-expect-error A handler constructs only its own errors; dependency errors still accumulate.
    void errors.Missing;
    return next({ context: {} });
  });
void contributesConflict;

// `.after` shifts the handler's input to the dependency's output and joins unions.
const auditedAccount = r
  .middleware<{ audited: true }>()
  .after(cookieMiddleware)
  .errors({ Missing })
  .use(({ context, next }) => {
    type _SeesDepOutput = Assert<Equal<typeof context.account, MaybeViewer>>;
    void (0 as unknown as _SeesDepOutput);
    return next({ context: { audited: true } });
  });

const auditedProcedure = r
  .procedure()
  .input(wire.object({}))
  .output(wire.string)
  .use(auditedAccount) // one use() pulls cookieMiddleware in too
  .query(({ context }) => {
    type _HasDep = Assert<Equal<typeof context.account, MaybeViewer>>;
    void (0 as unknown as _HasDep);
    type _HasOwn = Assert<Equal<typeof context.audited, true>>;
    void (0 as unknown as _HasOwn);
    return ok("");
  });
void auditedProcedure;

const fullyComposedProcedure = r
  .procedure()
  .input(wire.object({}))
  .output(wire.string)
  .errors({ Conflict })
  .use(auditedAccount)
  .errors({ DefaultPublic })
  .query(() => ok(""));
export type _ProcedureErrorsComposeWithoutAnnotation = Assert<
  Equal<
    ProcedureError<typeof fullyComposedProcedure>,
    ReturnType<typeof Conflict> | ReturnType<typeof Missing> | ReturnType<typeof DefaultPublic>
  >
>;

// Chained .after: each dependency shifts the handler input further.
const needsViewer = r
  .middleware<{ ok: true }>()
  .after(cookieMiddleware)
  .after(accountMiddleware)
  .use(({ context, next }) => {
    type _FullyNarrowed = Assert<Equal<typeof context.account, Viewer>>;
    void (0 as unknown as _FullyNarrowed);
    return next({ context: { ok: true } });
  });
void needsViewer;

// Sibling dependencies compose contributions; the later edge cannot erase
// context established by an earlier edge.
const siblingA = r
  .middleware<{ siblingA: true }>()
  .use(({ next }) => next({ context: { siblingA: true as const } }));
const siblingB = r
  .middleware<{ siblingB: true }>()
  .use(({ next }) => next({ context: { siblingB: true as const } }));
const joinedSiblings = r
  .middleware<{ joined: true }>()
  .after(siblingA)
  .after(siblingB)
  .use(({ context, next }) => {
    const a: true = context.siblingA;
    const b: true = context.siblingB;
    void a;
    void b;
    return next({ context: { joined: true as const } });
  });
void joinedSiblings;

// A middleware whose input demands context the procedure cannot supply is rejected.
declare const demandsViewer: import("../src/index.js").Middleware<
  import("../src/index.js").MiddlewareTypes<{ viewer: Viewer }, { viewer: Viewer; ok: true }, {}>
>;
r.procedure()
  .input(wire.object({}))
  .output(wire.string)
  // @ts-expect-error the root context has no viewer
  .use(demandsViewer);

// Services: the resolved record is fully typed and dependency-ordered.
const DbService = defineService("db", {
  create: () => ({ query: (sql: string) => [sql] }),
});
// @ts-expect-error Declared dependencies cannot be omitted and materialize as undefined at runtime.
defineService<string, { db: typeof DbService }>("unsound", {
  create: ({ db }) => db.query("select 1")[0]!,
});
const UsersService = defineService("users", {
  needs: { db: DbService },
  create: ({ db }) => {
    type _DepTyped = Assert<Equal<typeof db, { query: (sql: string) => string[] }>>;
    void (0 as unknown as _DepTyped);
    return { byId: (id: string) => db.query(id) };
  },
});
export type _ServiceNeedsStayAssociated = Assert<
  Equal<ServiceTypesOf<typeof UsersService>["needs"], { readonly db: typeof DbService }>
>;
export type _ServiceConstructionHasNoRecoverableError = Assert<
  Equal<ServiceTypesOf<typeof UsersService>["error"], never>
>;
const erasedUsersService: AnyServiceDefinition = UsersService;
// @ts-expect-error An erased service cannot be invoked without the resolver's dependency proof.
erasedUsersService.create({});
declare const resolved: Awaited<
  ReturnType<
    typeof resolveServices<{
      db: typeof DbService;
      users: typeof UsersService;
    }>
  >
>;
export type _ResolvedTyped = Assert<
  Equal<typeof resolved.users, { byId: (id: string) => string[] }>
>;

// --- Router-level inference --------------------------------------------------

const dbServer = serverRpc.context<{ readonly db: string }>();
const needsDb = dbServer
  .procedure()
  .output(wire.string)
  .query(({ context }) => ok(context.db));
// @ts-expect-error A router cannot provide less context than one of its procedures requires.
r.router({ needsDb });
serverRpc.context<Context & { readonly db: string }>().router({ needsDb });

const dbContractFactory = rpc.context<{ readonly db: string }>();
const needsDbContract = dbContractFactory.procedure().output(wire.string).query();
// @ts-expect-error Contract implementation cannot erase its declared root-context requirement.
r.implement(needsDbContract);
serverRpc.context<Context & { readonly db: string }>().implement(needsDbContract);

type Inputs = RouterInputs<typeof router>;
type Outputs = RouterOutputs<typeof router>;
type Errors = RouterErrors<typeof router>;

const exampleInputCodec = wire.object({ id: wire.string });
export type _RouterInput = Assert<
  Equal<Inputs["example"]["procedure"], InputOf<typeof exampleInputCodec>>
>;
export type _RouterOutput = Assert<Equal<Outputs["example"]["procedure"], string>>;
export type _RouterError = Assert<
  Equal<Errors["example"]["procedure"], ReturnType<typeof Missing>>
>;

// --- Namespaced errors -------------------------------------------------------

const nsErrors = defineErrors("billing", {
  cardDeclined: { data: wire.object({ code: wire.string }), httpStatus: 402 },
  planExpired: { httpStatus: 403 },
});
export type _NsTagDerived = Assert<
  Equal<ReturnType<typeof nsErrors.cardDeclined>["_tag"], "billing/card-declined">
>;
export type _NsDataTyped = Assert<
  Equal<ReturnType<typeof nsErrors.cardDeclined>["data"]["code"], string>
>;
// data-free members call with no arguments
void nsErrors.planExpired();
const billingMessage = errorCatalog(nsErrors, {
  "billing/card-declined": () => "declined" as const,
  "billing/plan-expired": () => 403 as const,
});
export type _CatalogReturnUnion = Assert<
  Equal<ReturnType<typeof billingMessage>, "declined" | 403>
>;
// @ts-expect-error the namespaced map is exhaustive for catalogs too
errorCatalog(nsErrors, { "billing/card-declined": () => "" });

// --- Result composition ------------------------------------------------------

import { toResult as toResultReact } from "../src/react/index.js";
import { all, andThen, gen, map, mapError, tryPromise } from "../src/index.js";
void toResultReact;

const Conflict2 = error({ tag: "type/conflict-two", data: wire.object({}), httpStatus: 409 });

declare const findResult: Result<string, ReturnType<typeof Missing>>;
declare const parseResult: Result<number, ReturnType<typeof Conflict2>>;

// gen accumulates exactly the yielded error union.
const genOutcome = gen(function* () {
  const doc = yield* findResult;
  const size = yield* parseResult;
  return `${doc}:${size}`;
});
export type _GenAccumulatesYieldedUnion = Assert<
  Equal<
    typeof genOutcome,
    Result<string, ReturnType<typeof Missing> | ReturnType<typeof Conflict2>>
  >
>;

// async gen returns a Promise of the same accumulation.
const genAsyncOutcome = gen(async function* () {
  const doc = yield* findResult;
  return doc.length;
});
export type _GenAsyncIsPromise = Assert<
  Equal<typeof genAsyncOutcome, Promise<Result<number, ReturnType<typeof Missing>>>>
>;

// all() collects tuple values positionally and unions the errors.
const allOutcome = all([findResult, parseResult]);
type AllValue = Extract<typeof allOutcome, { ok: true }>["value"];
type AllError = Extract<typeof allOutcome, { ok: false }>["error"];
export type _AllTupleIsPositional = Assert<Equal<AllValue, readonly [string, number]>>;
export type _AllUnionsErrors = Assert<
  Equal<AllError, ReturnType<typeof Missing> | ReturnType<typeof Conflict2>>
>;
const allRecordOutcome = all({ doc: findResult, size: parseResult });
type AllRecordValue = Extract<typeof allRecordOutcome, { ok: true }>["value"];
export type _AllRecordPreservesReadonlyKeys = Assert<
  Equal<AllRecordValue, { readonly doc: string; readonly size: number }>
>;

class SpecializedFailure extends TaggedError<
  "type/specialized",
  { readonly code: string },
  "public"
> {
  constructor(code: string) {
    super("type/specialized", { code }, "public");
  }
}
declare const specializedResult: Result<string, SpecializedFailure>;
const mappedSpecialized = map(specializedResult, (value) => value.length);
export type _MapPreservesTaggedSubclass = Assert<
  Equal<typeof mappedSpecialized, Result<number, SpecializedFailure>>
>;
const chainedSpecialized = andThen(specializedResult, () => parseResult);
export type _AndThenAccumulatesSubclassUnion = Assert<
  Equal<
    typeof chainedSpecialized,
    Result<number, SpecializedFailure | ReturnType<typeof Conflict2>>
  >
>;
const remappedSpecialized = mapError(specializedResult, () => Missing({ id: "mapped" }));
export type _MapErrorReplacesSubclassExactly = Assert<
  Equal<typeof remappedSpecialized, Result<string, ReturnType<typeof Missing>>>
>;

// tryPromise requires a tagged error from the catch handler.
const adopted = tryPromise(
  async () => 1,
  () => Missing({ id: "x" }),
);
export type _TryPromiseTagged = Assert<
  Equal<typeof adopted, Promise<Result<number, ReturnType<typeof Missing>>>>
>;
void tryPromise(
  async () => 1,
  // @ts-expect-error catch must return a tagged error, not an Error subclass
  (cause) => new Error(String(cause)),
);

// --- Regression: an implemented procedure keeps its contract's kind ---------
// `ProcedureImplementer.handler()` once widened the kind to
// `"query" | "mutation"`, which made every router-implemented procedure's
// client fail the `$kind: "query"` constraint — so `runtime.prefetch(...)`
// (the RSC server-prefetch path) could not typecheck against a server client.
// Found by the Waku RSC example; pinned here.
const kindContract = rpc
  .context<{}>()
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .query();
const kindMutationContract = rpc
  .context<{}>()
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .mutation();

const kindImplemented = serverRpc
  .context<{}>()
  .implement(kindContract)
  .handler(({ input }) => ok(input.id));
const kindMutationImplemented = serverRpc
  .context<{}>()
  .implement(kindMutationContract)
  .handler(({ input }) => ok(input.id));

type ImplementedQueryKind = typeof kindImplemented extends {
  readonly _def: { readonly kind: infer TKind };
}
  ? TKind
  : never;
type ImplementedMutationKind = typeof kindMutationImplemented extends {
  readonly _def: { readonly kind: infer TKind };
}
  ? TKind
  : never;

export type _ImplementedQueryStaysAQuery = Assert<Equal<ImplementedQueryKind, "query">>;
export type _ImplementedMutationStaysAMutation = Assert<Equal<ImplementedMutationKind, "mutation">>;

// The browser client derives `$kind` from the shared contract.
const kindRouterContract = rpc.context<{}>().contract({ read: kindContract });
const kindClient = createBrowserClient({
  contract: kindRouterContract,
  transport: { request: async () => ({ ok: false, reason: "network" }) },
});
type ReadKind = typeof kindClient.read.$kind;
export type _ClientProcedureIsAQuery = Assert<Equal<ReadKind, "query">>;

// --- A model never reaches an output un-scoped -----------------------------
// A model is the full truth about a row; an output ships one audience's view.
// The blanket form is gone from the surface, so a model that grows a sensitive
// column cannot silently widen every endpoint that mentions it. `all(reason)`
// is the one wide path, and it costs a sentence that lands in review.
const ScopedUser = defineModel("scoped-user", {
  key: "id",
  shape: {
    id: wire.string,
    name: wire.string,
    latestLat: wire.number,
  },
});

interface SourceUserRow {
  readonly id: string;
  readonly name: string;
  readonly latestLat: number;
  readonly privateMemo: string;
}

// Extra source fields are allowed; the assertion returns the same model type.
const SatisfiedScopedUser = ScopedUser.$satisfies<SourceUserRow>();
export type _SatisfiedModelKeepsItsDefinition = Assert<
  Equal<typeof SatisfiedScopedUser, typeof ScopedUser>
>;

// @ts-expect-error — a model field is absent from the source.
ScopedUser.$satisfies<Omit<SourceUserRow, "name">>();
// @ts-expect-error — source nullability and model nullability disagree.
ScopedUser.$satisfies<Omit<SourceUserRow, "name"> & { readonly name: string | null }>();
// @ts-expect-error — compatibility is exact in both directions, not merely assignable.
ScopedUser.$satisfies<Omit<SourceUserRow, "name"> & { readonly name: "Jökull" }>();

// @ts-expect-error — `codec` is not on the model surface: pick/select/all only.
const _noBlanketCodec = ScopedUser.codec;

// @ts-expect-error — all() states why this output may widen with the model.
const _allNeedsAReason = ScopedUser.all();

const ScopedCard = ScopedUser.pick("id", "name");
type Flat<T> = { readonly [K in keyof T]: T[K] };
type ScopedCardValue = Flat<InputOf<typeof ScopedCard>>;
export type _ViewShipsOnlyWhatItNames = Assert<
  Equal<ScopedCardValue, { readonly id: string; readonly name: string }>
>;

// select(): `true` for own fields, a codec for anything nested or computed.
const ScopedRow = ScopedUser.select({
  id: true,
  name: true,
  friend: ScopedCard,
  mutualCount: wire.number,
});
type ScopedRowValue = Flat<InputOf<typeof ScopedRow>>;
export type _SelectMixesFieldsCodecsAndComputed = Assert<
  Equal<
    ScopedRowValue,
    {
      readonly id: string;
      readonly name: string;
      readonly friend: InputOf<typeof ScopedCard>;
      readonly mutualCount: number;
    }
  >
>;

// The identity rule survives every form: a projection without its key is not
// an entity, it is data.
// @ts-expect-error — the key field is mandatory in a projection.
ScopedUser.pick("name");
// @ts-expect-error — select() must choose the key as an own field, not merely a codec.
ScopedUser.select({ id: wire.string, name: true });

const LocalizedContent = defineModel("localized-content", {
  key: ["id", "locale"],
  shape: {
    id: wire.string,
    locale: wire.string,
    title: wire.string,
  },
});

const OptionalProfile = defineModel("optional-profile", {
  key: "id",
  shape: {
    id: wire.string,
    nickname: wire.optional(wire.string),
  },
});
type OptionalProfileView = Flat<InputOf<ReturnType<typeof OptionalProfile.all>>>;
export type _OptionalModelFieldsStayOptional = Assert<
  Equal<OptionalProfileView, { readonly id: string; readonly nickname?: string }>
>;

export type _UnionModelValuesDistribute = Assert<
  Equal<
    ModelValue<typeof ScopedUser | typeof LocalizedContent>,
    ModelValue<typeof ScopedUser> | ModelValue<typeof LocalizedContent>
  >
>;
declare const safeUnionProjection: ModelProjection<typeof ScopedUser | typeof LocalizedContent>;
const sharedUnionIdentity: string = safeUnionProjection.id;
void sharedUnionIdentity;

LocalizedContent.pick("id", "locale", "title");
LocalizedContent.select({ id: true, locale: true, title: true });
// @ts-expect-error — every field in a composite identity is mandatory.
LocalizedContent.pick("id", "title");
// @ts-expect-error — composite identity applies to structured selections too.
LocalizedContent.select({ id: true, title: true });

const acceptsLocalizedKey = (_key: ModelKeyInput<typeof LocalizedContent>) => undefined;
// @ts-expect-error — ambiguous pre-joined composite identities are not accepted.
acceptsLocalizedKey("doc:en");
acceptsLocalizedKey({ id: "doc", locale: "en" });
// @ts-expect-error — model-specific key records require every identity field.
acceptsLocalizedKey({ id: "doc" });
// @ts-expect-error — model-specific key records reject unrelated identity fields.
acceptsLocalizedKey({ id: "doc", locale: "en", tenant: "acme" });

defineModel("invalid-object-key", {
  // @ts-expect-error — entity identity codecs must decode to string or number.
  key: "identity",
  shape: { identity: wire.object({ nested: wire.string }) },
});

defineModel("invalid-nullable-key", {
  // @ts-expect-error — nullable identity cannot produce a stable entity id.
  key: "identity",
  shape: { identity: wire.union([wire.string, wire.null]) },
});

// Every exported Any* surface is a real existential: a specific value widens
// into it without an assertion, while the erased form cannot manufacture a
// codec input, service dependency record, or layer procedure argument.
const erasedProcedure: AnyProcedure = procedure;
const erasedProcedureContract: AnyProcedureContract = contractProcedure;
const erasedRouter: AnyRouter = router;
const erasedRouterContract: AnyRouterContract = kindRouterContract;
const erasedModel: AnyModel = ScopedUser;
const erasedLayer: AnyLayer = SessionLayer;
const erasedShell: AnyShell = AuthShell;
const erasedLayerShell: AnyLayerShell = SessionShell;
void [
  erasedProcedure,
  erasedProcedureContract,
  erasedRouter,
  erasedRouterContract,
  erasedModel,
  erasedLayer,
  erasedShell,
  erasedLayerShell,
];

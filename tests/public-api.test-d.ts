import {
  type InputOf,
  type ClientBoundaryError,
  type ServerBadRequest,
  type Result,
  TaggedError,
  ServerInternal,
  err,
  error,
  ok,
  wire,
  type WireCodec,
  matchError,
  isTaggedError,
} from "../src/index.js";
import { createBrowserClient, type ClientErrors } from "../src/client/index.js";
import { createServerClient } from "../src/server/index.js";
import { defineModel } from "../src/model.js";
import { type PaginatedState, type QueryState } from "../src/react/index.js";
import { createQueryRuntime } from "../src/query/runtime.js";
// @ts-expect-error the React entry is `use client`; runtime construction belongs to result-rpc/query
import { createQueryRuntime as unsafeReactRuntime } from "../src/react/index.js";
void unsafeReactRuntime;
import { rpc, type RouterErrors, type RouterInputs, type RouterOutputs } from "../src/index.js";
import {
  defectErrors,
  defineErrors,
  defineLayer,
  defineService,
  errorCatalog,
  resolveServices,
  staleErrors,
  transportErrors,
} from "../src/index.js";
import { defineShell, layerShell, type ClaimedBy, type ValueOf } from "../src/react/index.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

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

const DefaultPublic = error({
  tag: "type/default-public",
  data: wire.object({}),
});

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

const r = rpc.context<Context>();

r.procedure().errors({ DefaultPublic });
// @ts-expect-error Private errors are server-only composition currency, not RPC contract errors.
r.procedure().errors({ PrivateFailure });
// @ts-expect-error Middleware errors can cross the wire and must therefore be public.
r.middleware().errors({ PrivateFailure });
// @ts-expect-error A map containing a private definition cannot become an RPC error map.
r.procedure().errors(visibilityErrors);

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
const contractProcedure = r
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ Missing })
  .query();
const mutationContract = r
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ Missing })
  .mutation();
const subscriptionContract = r
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ Missing })
  .subscription();
const paginatedContract = r
  .procedure()
  .input(wire.object({ q: wire.string }))
  .output(wire.string)
  .errors({ Missing })
  .paginate({ cursor: wire.string });
const contract = r.contract({
  example: {
    procedure: contractProcedure,
    mutation: mutationContract,
    subscription: subscriptionContract,
    paginated: paginatedContract,
  },
});
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
// @ts-expect-error Mutation procedures cannot be used as cache keys.
runtime.cache.get(client.example.mutation, { id: "valid" });
const observer = runtime.observe(client.example.procedure, { id: "valid" });
type ObservedState = ReturnType<typeof observer.getCurrentState>;
type ExpectedState = QueryState<string, ExpectedError>;
export type _QueryPreservesClosedError = Assert<Equal<ObservedState, ExpectedState>>;

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

declare const useShellQuery: typeof AuthShell.useQuery;
type ShellState = ReturnType<typeof useShellQuery<typeof client.example.procedure>>;
type ShellError = Extract<ShellState, { readonly state: "failure" }>["error"];

// Every framework tag is absorbed by an enclosing layer; only the domain error
// the procedure declares survives into the component.
export type _ShellSubtractsExactlyTheClaimedTags = Assert<
  Equal<ShellError, ReturnType<typeof Missing>>
>;

declare const useShellPaginated: typeof AuthShell.usePaginatedQuery;
type ShellPaginatedState = ReturnType<typeof useShellPaginated<typeof client.example.paginated>>;
type ShellPaginatedError = Extract<ShellPaginatedState, { readonly state: "failure" }>["error"];
export type _PaginatedShellSubtractsExactlyTheClaimedTags = Assert<
  Equal<ShellPaginatedState, PaginatedState<string, string, ReturnType<typeof Missing>>>
>;
export type _PaginatedShellErrorIsNarrow = Assert<
  Equal<ShellPaginatedError, ReturnType<typeof Missing>>
>;

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
const sessionContract = SessionLayer.contract(r);
type SessionOutput = typeof sessionContract extends {
  readonly _def: { readonly output: WireCodec<infer T, any> };
}
  ? T
  : never;
export type _LayerContractOutput = Assert<Equal<SessionOutput, Viewer>>;

// The derived shell claims exactly the layer union plus its parents' claims.
const SessionShell = layerShell(SessionLayer, {
  from: DefectShell,
  procedure: client.example.procedure,
});
export type _LayerShellValue = Assert<Equal<ValueOf<typeof SessionShell>, Viewer>>;
export type _LayerShellHandled = Assert<
  Equal<ClaimedBy<typeof SessionShell>, ClaimedBy<typeof DefectShell> | "type/conflict">
>;

// --- Optional layers and refinement ----------------------------------------

const MaybeViewerCodec = wire.union([ViewerCodec, wire.null] as const);
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

const cookieMiddleware = CookieLayer.middleware(r, () => ok(null as MaybeViewer));
const accountMiddleware = AccountLayer.middleware(r);

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
  .use(cookieMiddleware)
  .use(accountMiddleware)
  .query(({ context }) => {
    type _Narrowed = Assert<Equal<typeof context.account, Viewer>>;
    void (0 as unknown as _Narrowed);
    return ok(context.account.id);
  });

// the refined layer's shell provides the narrowed value and claims its union
const CookieShell = layerShell(CookieLayer, {
  from: DefectShell,
  procedure: client.example.procedure,
});
const AccountShell = layerShell(AccountLayer, {
  from: CookieShell,
  procedure: client.example.procedure,
});
export type _OptionalShellValue = Assert<Equal<ValueOf<typeof CookieShell>, MaybeViewer>>;
export type _RequiredShellValue = Assert<Equal<ValueOf<typeof AccountShell>, Viewer>>;
export type _RequiredShellHandled = Assert<
  Equal<ClaimedBy<typeof AccountShell>, ClaimedBy<typeof CookieShell> | "type/missing">
>;

// --- Middleware dependencies and services ----------------------------------

// `.after` shifts the handler's input to the dependency's output and joins unions.
const auditedAccount = r
  .middleware<{ audited: true }>()
  .after(cookieMiddleware)
  .errors({ Missing })
  .use(({ context, next }) => {
    type _SeesDepOutput = Assert<Equal<typeof context.account, MaybeViewer>>;
    void (0 as unknown as _SeesDepOutput);
    return next({ context: { ...context, audited: true as const } });
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

// Chained .after: each dependency shifts the handler input further.
const needsViewer = r
  .middleware<{ ok: true }>()
  .after(cookieMiddleware)
  .after(accountMiddleware)
  .use(({ context, next }) => {
    type _FullyNarrowed = Assert<Equal<typeof context.account, Viewer>>;
    void (0 as unknown as _FullyNarrowed);
    return next({ context: { ...context, ok: true as const } });
  });
void needsViewer;

// A middleware whose input demands context the procedure cannot supply is rejected.
declare const demandsViewer: import("../src/index.js").Middleware<
  { viewer: Viewer },
  { viewer: Viewer; ok: true },
  {}
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
const UsersService = defineService("users", {
  needs: { db: DbService },
  create: ({ db }) => {
    type _DepTyped = Assert<Equal<typeof db, { query: (sql: string) => string[] }>>;
    void (0 as unknown as _DepTyped);
    return { byId: (id: string) => db.query(id) };
  },
});
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
// @ts-expect-error the namespaced map is exhaustive for catalogs too
errorCatalog(nsErrors, { "billing/card-declined": () => "" });

// --- Result composition ------------------------------------------------------

import { toResult as toResultReact } from "../src/react/index.js";
import { all, gen, tryPromise } from "../src/index.js";
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
const allOutcome = all([findResult, parseResult] as const);
type AllValue = Extract<typeof allOutcome, { ok: true }>["value"];
type AllError = Extract<typeof allOutcome, { ok: false }>["error"];
export type _AllTupleIsPositional = Assert<
  Equal<[AllValue[0], AllValue[1], AllValue["length"]], [string, number, 2]>
>;
export type _AllUnionsErrors = Assert<
  Equal<AllError, ReturnType<typeof Missing> | ReturnType<typeof Conflict2>>
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

const kindImplemented = rpc
  .context<{}>()
  .implement(kindContract)
  .handler(({ input }) => ok(input.id));
const kindMutationImplemented = rpc
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

// The payoff: a client built from the implemented router exposes `$kind:
// "query"`, so the RSC prefetch path accepts it.
const kindRouter = rpc.context<{}>().router({ read: kindImplemented });
const kindClient = createBrowserClient({
  router: kindRouter,
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
const _pickNeedsKey = ScopedUser.pick("name");

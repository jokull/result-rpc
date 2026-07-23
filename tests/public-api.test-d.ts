import {
  type InputOf,
  type ClientBoundaryError,
  type Result,
  ServerInternal,
  err,
  error,
  ok,
  wire,
  type WireCodec,
  matchError,
} from "../src/index.js";
import { createClient } from "../src/client/index.js";
import { createQueryRuntime, type QueryState } from "../src/query/index.js";
import { rpc, type RouterErrors, type RouterInputs, type RouterOutputs } from "../src/contract/index.js";
import { defectErrors, defineErrors, defineLayer, defineService, errorCatalog, resolveServices, transportErrors } from "../src/index.js";
import { defineShell, layerShell, type HandledBy, type ValueOf } from "../src/react/index.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
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

interface Context {
  readonly authenticated: boolean;
}

const r = rpc.context<Context>();
const procedure = r
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ Missing })
  .query(({ input, errors }) => input.id === "missing"
    ? err(errors.Missing({ id: input.id }))
    : ok(input.id));

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
const contract = r.contract({
  example: {
    procedure: contractProcedure,
    mutation: mutationContract,
    subscription: subscriptionContract,
  },
});
const client = createClient({
  contract,
  transport: { request: async () => ({ ok: false, reason: "network" }) },
});
void router;

type CallResult = Awaited<ReturnType<typeof client.example.procedure>>;
type CallError = CallResult extends Result<unknown, infer E> ? E : never;
type ExpectedError =
  | ReturnType<typeof Missing>
  | ReturnType<typeof ServerInternal>
  | ClientBoundaryError;

type _ClientErrorIsClosed = Assert<Equal<CallError, ExpectedError>>;

// @ts-expect-error Input is inferred from the procedure codec.
void client.example.procedure({ id: 123 });
void client.example.procedure({ id: "valid" });

const runtime = createQueryRuntime({ client });
// @ts-expect-error Mutation procedures cannot be used as cache keys.
runtime.cache.get(client.example.mutation, { id: "valid" });
const observer = runtime.observe(client.example.procedure, { id: "valid" });
type ObservedState = ReturnType<typeof observer.getCurrentState>;
type ExpectedState = QueryState<string, ExpectedError>;
type _QueryPreservesClosedError = Assert<Equal<ObservedState, ExpectedState>>;

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
type _SubscriptionResultIsClosed = Assert<Equal<
  Exclude<SubscriptionResult, undefined>,
  Result<string, ExpectedError>
>>;

// --- Shell narrowing -------------------------------------------------------

const TransportShell = defineShell({
  name: "transport",
  handle: transportErrors,
  effect: "pause",
});

const DefectShell = defineShell({
  name: "defect",
  from: TransportShell,
  handle: defectErrors,
  effect: "escalate",
});

const AuthShell = defineShell({
  name: "auth",
  from: DefectShell,
  handle: { Conflict },
  provide: (props: { readonly userId: string }) => ({ userId: props.userId }),
});

declare const useShellQuery: typeof AuthShell.useQuery;
type ShellState = ReturnType<typeof useShellQuery<typeof client.example.procedure>>;
type ShellError = ShellState extends { readonly result: infer R }
  ? R extends { readonly ok: false; readonly error: infer E } ? E : never
  : never;

// Every framework tag is absorbed by an enclosing layer; only the domain error
// the procedure declares survives into the component.
type _ShellSubtractsExactlyTheClaimedTags = Assert<
  Equal<ShellError, ReturnType<typeof Missing>>
>;

// The chain accumulates: the innermost layer sees its parents' claims too.
type _ChainAccumulates = Assert<Equal<
  HandledBy<typeof AuthShell>,
  HandledBy<typeof DefectShell> | "type/conflict"
>>;

// The guaranteed value is not optional inside the layer.
type _ProvidedValueIsGuaranteed = Assert<Equal<
  ValueOf<typeof AuthShell>,
  { userId: string }
>>;

// --- Layer factory ---------------------------------------------------------

const ViewerCodec = wire.object({ id: wire.string })
type Viewer = InputOf<typeof ViewerCodec>

const SessionLayer = defineLayer({
  name: "session",
  key: "viewer",
  provides: ViewerCodec,
  errors: { Conflict },
})

const sessionMiddleware = SessionLayer.middleware(r, ({ context, errors }) =>
  context.authenticated
    ? ok({ id: "u_1" })
    : err(errors.Conflict({ id: "u_1" })))

// The middleware adds the layer value to context under the declared key.
const layered = r
  .procedure()
  .input(wire.object({}))
  .output(wire.string)
  .use(sessionMiddleware)
  .query(({ context }) => ok(context.viewer.id))
void layered

r.procedure()
  .input(wire.object({}))
  .output(wire.string)
  .use(sessionMiddleware)
  // @ts-expect-error The layer value is exactly the provides codec's type.
  .query(({ context }) => ok(context.viewer.missing))

// The context procedure's contract carries the layer value and union.
const sessionContract = SessionLayer.contract(r)
type SessionOutput = typeof sessionContract extends {
  readonly _def: { readonly output: WireCodec<infer T, any> }
} ? T : never
type _LayerContractOutput = Assert<Equal<SessionOutput, Viewer>>

// The derived shell claims exactly the layer union plus its parents' claims.
const SessionShell = layerShell(SessionLayer, {
  from: DefectShell,
  procedure: client.example.procedure,
})
type _LayerShellValue = Assert<Equal<ValueOf<typeof SessionShell>, Viewer>>
type _LayerShellHandled = Assert<Equal<
  HandledBy<typeof SessionShell>,
  HandledBy<typeof DefectShell> | "type/conflict"
>>

// --- Optional layers and refinement ----------------------------------------

const MaybeViewerCodec = wire.union([ViewerCodec, wire.null] as const)
type MaybeViewer = InputOf<typeof MaybeViewerCodec>

// optional: always establishes, may provide null
const CookieLayer = defineLayer({
  name: "cookie",
  key: "account",
  provides: MaybeViewerCodec,
  errors: {},
})

// required: narrows the same key, contributes the failure union
const AccountLayer = CookieLayer.require({
  name: "account",
  provides: ViewerCodec,
  errors: { Missing },
  refine: ({ value, errors }) =>
    value === null ? err(errors.Missing({ id: "anonymous" })) : ok(value),
})

const cookieMiddleware = CookieLayer.middleware(r, () => ok(null as MaybeViewer))
const accountMiddleware = AccountLayer.middleware(r)

// context grows and narrows monotonically through the chain
r.procedure()
  .input(wire.object({}))
  .output(wire.string)
  .use(cookieMiddleware)
  .query(({ context }) => {
    type _Nullable = Assert<Equal<typeof context.account, MaybeViewer>>
    return ok("")
  })

r.procedure()
  .input(wire.object({}))
  .output(wire.string)
  .use(cookieMiddleware)
  .use(accountMiddleware)
  .query(({ context }) => {
    type _Narrowed = Assert<Equal<typeof context.account, Viewer>>
    return ok(context.account.id)
  })

// the refined layer's shell provides the narrowed value and claims its union
const CookieShell = layerShell(CookieLayer, {
  from: DefectShell,
  procedure: client.example.procedure,
})
const AccountShell = layerShell(AccountLayer, {
  from: CookieShell,
  procedure: client.example.procedure,
})
type _OptionalShellValue = Assert<Equal<ValueOf<typeof CookieShell>, MaybeViewer>>
type _RequiredShellValue = Assert<Equal<ValueOf<typeof AccountShell>, Viewer>>
type _RequiredShellHandled = Assert<Equal<
  HandledBy<typeof AccountShell>,
  HandledBy<typeof CookieShell> | "type/missing"
>>

// --- Middleware dependencies and services ----------------------------------

// `.after` shifts the handler's input to the dependency's output and joins unions.
const auditedAccount = r
  .middleware<{ audited: true }>()
  .after(cookieMiddleware)
  .errors({ Missing })
  .use(({ context, next }) => {
    type _SeesDepOutput = Assert<Equal<typeof context.account, MaybeViewer>>
    return next({ context: { ...context, audited: true as const } })
  })

const auditedProcedure = r
  .procedure()
  .input(wire.object({}))
  .output(wire.string)
  .use(auditedAccount) // one use() pulls cookieMiddleware in too
  .query(({ context }) => {
    type _HasDep = Assert<Equal<typeof context.account, MaybeViewer>>
    type _HasOwn = Assert<Equal<typeof context.audited, true>>
    return ok("")
  })
void auditedProcedure

// Chained .after: each dependency shifts the handler input further.
const needsViewer = r
  .middleware<{ ok: true }>()
  .after(cookieMiddleware)
  .after(accountMiddleware)
  .use(({ context, next }) => {
    type _FullyNarrowed = Assert<Equal<typeof context.account, Viewer>>
    return next({ context: { ...context, ok: true as const } })
  })
void needsViewer

// A middleware whose input demands context the procedure cannot supply is rejected.
declare const demandsViewer: import("../src/contract/index.js").Middleware<
  { viewer: Viewer },
  { viewer: Viewer; ok: true },
  {}
>
r.procedure()
  .input(wire.object({}))
  .output(wire.string)
  // @ts-expect-error the root context has no viewer
  .use(demandsViewer)

// Services: the resolved record is fully typed and dependency-ordered.
const DbService = defineService("db", {
  create: () => ({ query: (sql: string) => [sql] }),
})
const UsersService = defineService("users", {
  needs: { db: DbService },
  create: ({ db }) => {
    type _DepTyped = Assert<Equal<typeof db, { query: (sql: string) => string[] }>>
    return { byId: (id: string) => db.query(id) }
  },
})
declare const resolved: Awaited<ReturnType<typeof resolveServices<{
  db: typeof DbService
  users: typeof UsersService
}>>>
type _ResolvedTyped = Assert<Equal<typeof resolved.users, { byId: (id: string) => string[] }>>

// --- Router-level inference --------------------------------------------------

type Inputs = RouterInputs<typeof router>
type Outputs = RouterOutputs<typeof router>
type Errors = RouterErrors<typeof router>

const exampleInputCodec = wire.object({ id: wire.string })
type _RouterInput = Assert<Equal<Inputs["example"]["procedure"], InputOf<typeof exampleInputCodec>>>
type _RouterOutput = Assert<Equal<Outputs["example"]["procedure"], string>>
type _RouterError = Assert<Equal<Errors["example"]["procedure"], ReturnType<typeof Missing>>>

// --- Namespaced errors -------------------------------------------------------

const nsErrors = defineErrors("billing", {
  cardDeclined: { data: wire.object({ code: wire.string }), httpStatus: 402 },
  planExpired: { httpStatus: 403 },
})
type _NsTagDerived = Assert<Equal<
  ReturnType<typeof nsErrors.cardDeclined>["_tag"],
  "billing/card-declined"
>>
type _NsDataTyped = Assert<Equal<
  ReturnType<typeof nsErrors.cardDeclined>["data"]["code"],
  string
>>
// data-free members call with no arguments
void nsErrors.planExpired()
// @ts-expect-error the namespaced map is exhaustive for catalogs too
errorCatalog(nsErrors, { "billing/card-declined": () => "" })

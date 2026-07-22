import {
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
import { rpc } from "../src/contract/index.js";

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

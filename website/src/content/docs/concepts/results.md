---
title: "Result composition"
description: "better-result 3.0 is the Result runtime — result-rpc adds one rule: the error channel only admits declared, serializable, reifiable tagged errors."
---

The Result algebra is [better-result](https://github.com/dmmulroy/better-result) 3.0,
brought in as a peer dependency (one shared `Ok`/`Err` class across your app —
see the FAQ) — not reimplemented. result-rpc adds one rule to
the general-purpose library: the error channel only admits reified result-rpc
`TaggedError` instances whose `data` is wire-safe, because every error here is
presumed to eventually cross a wire, land in a procedure's declared union, and
be matched exhaustively in a component. The declared definition supplies both
the nominal runtime type and the plain wire shape, so a merely shape-compatible
object is rejected at the procedure boundary.

If you already use better-result, adoption is the point: a
`Result<T, YourRpcError>` whose error is a result-rpc tagged error flows into a
procedure handler as-is. A foreign error is folded with `mapError` before the
boundary.

## The surface

`Result<T, E>` is a better-result Result whose error type is constrained to
result-rpc tagged errors. Factories come from result-rpc; everything else is
better-result's own surface.

|                     |                                                |
| ------------------- | ---------------------------------------------- |
| Construct           | `ok`, `err`, `isOk`, `isErr` from `result-rpc` |
| Discriminate        | `result.status === "ok"` or `result.isOk()`    |
| Transform           | `map`, `mapError`, `andThen`, `tryRecover`     |
| Unwrap              | `match`, `matchError`, `unwrapOr`, `unwrap`    |
| Observe             | `tap`, `tapError`, `tapBoth`                   |
| Adopt throwing code | `tryCatch` / `tryPromise` (`fn, onThrow`)      |
| Combine             | `Result.all` (tuple, first failure wins)       |
| Compose             | `gen` (generator style, `yield*`)              |

Combinators beyond `ok`/`err`/`isOk`/`isErr` are re-exported by result-rpc
(they are better-result's): `map`, `mapError`, `andThen`, `match`,
`matchError`, `tap*`, `all`, `gen`, `tryRecover`, `unwrap`, `unwrapOr`,
`tryCatch`, `tryPromise`, and the `InferErr`/`InferOk` types. Calling
conventions are better-result's, unchanged — `gen` bodies return a Result,
`tryCatch`/`tryPromise` are passthroughs of `Result.try`/`Result.tryPromise`
(the `{ try, catch }` form) so the throwing boundary needs no second import.
Renames in 0.3: `orElse` → `tryRecover`, `getOrElse` → `unwrapOr` (value
fallback) or `match`.

Results are better-result `Ok`/`Err` class instances with a
`status: "ok" | "error"` discriminant. The 0.2 `.ok` boolean discriminant is
gone:

```ts
if (result.status === "ok") {
  result.value; // narrowed
} else {
  result.error; // narrowed
}
// or the method form, which narrows the same way:
if (result.isOk()) result.value;
```

A `Promise<Result>` stays a plain promise you `await` — there is no
`ResultAsync` to learn.

## Generator composition

`yield*` works directly on any Result: it unwraps the value or
short-circuits the whole block on the first failure. The error union
accumulates automatically from everything yielded. A gen body **returns a
Result** (`return ok(value)`), matching better-result's `Result.gen`:

```ts
import { gen, ok } from "result-rpc";

const outcome = gen(function* () {
  const doc = yield* findDoc(id); // Result<Doc, DocNotFound>
  const body = yield* parseBody(doc); // Result<Body, ParseFailure>
  return ok(render(doc, body));
});
// Result<Rendered, DocNotFound | ParseFailure>
```

Pass an async generator to compose awaited Results the same way — the return
type becomes a `Promise<Result>`:

```ts
const outcome = await gen(async function* () {
  const doc = yield* await fetchDoc(id);
  const body = yield* parseBody(doc);
  return ok(body);
});
```

Three idioms worth knowing: `return yield* err(SomeError({ ... }))` fails a
block explicitly; a `TaggedError` is itself yieldable, so
`return yield* SomeError({ ... })` is the shorter equivalent; and `finally`
blocks run even when an `Err` short-circuits — cleanup composes normally.

## The wire keeps the API, not the object identity

The client reconstructs the Result and the exact declared `TaggedError`
instance before returning — via the per-procedure Result codec and the error
registry:

```ts
import { gen } from "result-rpc";
import { client } from "./rpc-client";
import { docErrors } from "./errors";

const outcome = await gen(async function* () {
  // The response crossed HTTP. It is still a result-rpc Result, so yield*
  // unwraps success or propagates its reconstructed TaggedError.
  const doc = yield* await client.doc.byId({ id: "doc_missing" });
  const body = yield* parseBody(doc.body);
  return ok({ doc, body });
});

if (outcome.isErr() && docErrors.notFound.is(outcome.error)) {
  outcome.error instanceof Error; // true
  outcome.error.data.docId; // "doc_missing"

  const propagated = gen(function* () {
    return yield* outcome.error; // the reconstructed error is yieldable too
  });
}
```

The instance is newly constructed on the client; pretending it is the same
JavaScript object would be meaningless. What survives is the faithful public
API: definition guards, `Error` interoperability, typed data, `toJSON`, and
generator composition.

That fidelity is not portable through arbitrary serializers. JSON, Next
server actions/RPC, and component-prop serialization do not have the
procedure's error registry, so they cannot reconstruct the runtime types.
Unwrap before crossing one of those boundaries:

```tsx
const result = await client.doc.byId({ id });
if (result.isErr()) return <NotFound docId={result.error.data.docId} />;
return <DocView doc={result.value} />; // pass T, not Result<T, E>
```

## The worked example: an upstream service, composed to the screen

The pattern that earns this page: a result-ified upstream (`safeJsonFetch`),
granular internally, **collapsed to one declared domain tag at the procedure
boundary** so the client union stays coarse.

The service keeps its own precise error vocabulary:

```ts
// server/services/rates.ts
import { defineErrors, err, gen, ok, tryPromise, wire } from "result-rpc";

export const upstream = defineErrors("upstream", {
  unavailable: { data: wire.object({ status: wire.number }), httpStatus: 502, retry: "transient" },
  malformed: { data: wire.object({ reason: wire.string }), httpStatus: 502 },
});

export const safeJsonFetch = (url: string) =>
  gen(async function* () {
    const response = yield* await tryPromise({
      try: () => fetch(url),
      catch: () => upstream.unavailable({ status: 0 }),
    });
    if (!response.ok) {
      return err(upstream.unavailable({ status: response.status }));
    }
    return yield* await tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) => upstream.malformed({ reason: String(cause) }),
    });
  });
// Promise<Result<unknown, UpstreamUnavailable | UpstreamMalformed>>
```

`tryPromise` (a passthrough of better-result's `Result.tryPromise`) is the
border checkpoint: its catch handler produces the declared tagged error, so
the upstream's `TypeError`/`SyntaxError` never travels past the boundary as
itself.

The procedure does **not** re-export that granularity. Two upstream tags
would be noise in every component that renders a quote — the caller can't do
anything different with `unavailable` versus `malformed`. So the handler
collapses them with `mapError`, and only the coarse tag enters the contract:

```ts
// server/router.ts
import { error, err, gen, mapError, wire } from "result-rpc";
import { safeJsonFetch } from "./services/rates";

const RatesUnavailable = error({
  tag: "rates/unavailable",
  data: wire.object({}),
  httpStatus: 503,
  retry: "transient",
});

const quote = server
  .procedure()
  .input(wire.object({ currency: wire.string }))
  .output(wire.object({ currency: wire.string, rate: wire.number }))
  .errors({ RatesUnavailable })
  .query(({ input, errors }) =>
    gen(async function* () {
      const payload = yield* mapError(
        await safeJsonFetch(`https://rates.example/api/${input.currency}`),
        () => errors.RatesUnavailable({}), // two granular tags → one declared tag
      );
      const rate = (payload as { rate?: number }).rate;
      if (typeof rate !== "number") return yield* err(errors.RatesUnavailable({}));
      return ok({ currency: input.currency, rate });
    }),
  );
```

The type system enforces the collapse: a handler returning an undeclared
`upstream/unavailable` is a compile error, and one smuggled at runtime is
sanitized to `server/internal`. Simplifying the union is not a style
suggestion — it is the only way past the `.errors()` gate.

On the client, nothing new to learn — it is the same flattened state every
query has, and the domain branch is exactly one tag wide:

```tsx
function Quote({ currency }: { currency: string }) {
  const quote = AppShell.useQuery(client.rates.quote, { currency });

  switch (quote.state) {
    case "pending":
      return <Skeleton />;
    case "success":
      return <Rate value={quote.value.rate} />;
    case "failure":
      return <RatesDown retry={quote.refetch} />;
    // quote.error: RatesUnavailable — the upstream vocabulary never leaked
  }
}
```

That is the full journey: throwing `fetch` → `tryPromise` → granular
service union → `mapError` collapse at the procedure → declared contract →
flattened hook state. One algebra, and each boundary decides how much detail
the next one deserves. When hook-state code needs to hand a settled outcome
to Result-typed code, `toResult(quote)` re-wraps it.

## Composition between layers

Layer middleware resolves to a Result, so `gen` composes there too — the
layer's declared union is the gate, exactly like a procedure's:

```ts
const session = defineLayer({
  name: "session",
  key: "viewer",
  provides: ViewerCodec,
  errors: { SessionExpired, SessionRevoked },
});

const sessionMiddleware = session.middleware(server, ({ context, errors }) =>
  gen(async function* () {
    const token = yield* readToken(context.cookie, errors); // Result<Token, SessionExpired>
    const viewer = yield* await lookupViewer(token, errors); // Result<Viewer, SessionRevoked>
    return ok(viewer);
  }),
);
```

Everything downstream of the middleware sees `context.viewer` as guaranteed;
the failure paths travel the layer's union to the client, where the layer's
shell claims them. Composition on the server, subtraction on the client —
the same union both times.

## The boundary guarantee

Every failure entering or leaving a result-rpc procedure is an instance of a
declared, serializable, reifiable tagged error. The per-procedure Result codec
enforces this at runtime — static typing is not the boundary:

- A foreign or counterfeit error is rejected, even through `any`.
- A private error never crosses any client boundary; it is sanitized to
  `server/internal`.
- A better-result `Panic` (a Result callback threw) becomes a sanitized
  framework failure; its cause reaches server-side observability, never the
  wire.
- `Result<T, string>` or any other non-tagged local error fails procedure
  typing and runtime validation.

## Credit and deliberate omissions

This surface **is** better-result 3.0, used directly. result-rpc deliberately
does not add on top of it:

- **A second serialization story.** The per-procedure Result codec (built on
  `Result.codec` with Standard Schema adapters) is the Result-level
  serialization; the outer protocol frame, contract digest, batch framing,
  and touched entities stay result-rpc-owned.
- **`ResultAsync` / chained async wrappers.** `await` plus `gen` covers the
  composition; a wrapper class would add a second calling convention to
  every API that touches a promise.
- **`getOrThrow` / `unwrapOr` on failure.** Re-throwing is the pattern the
  rest of the library exists to retire. Where you genuinely want to crash on
  `Err` (scripts, tests), `if (result.isErr()) throw result.error` is one
  honest line.

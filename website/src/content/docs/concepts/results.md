---
title: "Result composition"
description: "better-result and neverthrow are built in — with tagged errors required, because every error here is presumed to eventually cross a wire."
---

If you use neverthrow or better-result today, this page is the migration
note: the algebra you know is built in, and you can delete the dependency.
One rule is stricter — the error channel only admits tagged errors (`_tag` +
wire-safe `data`). That restriction is the point. The standalone libraries
let any value ride the error channel because they never have to move it;
here every error is presumed to eventually cross a wire, land in a
procedure's declared union, and be matched exhaustively in a component. The
tagged shape is what survives that whole trip, so it is required from the
first `err()`.

## The surface

| | |
| --- | --- |
| Construct | `ok`, `err`, `isOk`, `isErr` |
| Transform | `map`, `andThen`, `mapError`, `orElse` |
| Unwrap | `match`, `matchError`, `getOrElse` |
| Observe | `tap`, `tapError`, `tapBoth` |
| Adopt throwing code | `tryCatch`, `tryPromise` |
| Combine | `all` (tuple or record, first failure wins) |
| Compose | `gen` (generator style, `yield*`) |

All standalone functions, all tree-shakeable, no wrapper classes. A
`Promise<Result>` stays a plain promise you `await` — there is no
`ResultAsync` to learn.

## Generator composition

`yield*` works directly on any Result: it unwraps the value or
short-circuits the whole block on the first failure. The error union
accumulates automatically from everything yielded — no annotations:

```ts
import { gen } from "result-rpc"

const outcome = gen(function* () {
  const doc = yield* findDoc(id)        // Result<Doc, DocNotFound>
  const body = yield* parseBody(doc)    // Result<Body, ParseFailure>
  return render(doc, body)
})
// Result<Rendered, DocNotFound | ParseFailure>
```

Pass an async generator to compose awaited Results the same way — the return
type becomes a `Promise<Result>`:

```ts
const outcome = await gen(async function* () {
  const doc = yield* await fetchDoc(id)
  return yield* parseBody(doc)
})
```

Two idioms worth knowing: `return yield* err(SomeError({ ... }))` fails a
block explicitly from the middle, and `finally` blocks run even when an
`Err` short-circuits — cleanup composes normally.

## The worked example: an upstream service, composed to the screen

The pattern that earns this page: a result-ified upstream (`safeJsonFetch`),
granular internally, **collapsed to one declared domain tag at the procedure
boundary** so the client union stays coarse.

The service keeps its own precise error vocabulary:

```ts
// server/services/rates.ts
import { defineErrors, err, gen, tryPromise, wire } from "result-rpc"

export const upstream = defineErrors("upstream", {
  unavailable: { data: wire.object({ status: wire.number }), httpStatus: 502, retry: "transient" },
  malformed: { data: wire.object({ reason: wire.string }), httpStatus: 502 },
})

export const safeJsonFetch = (url: string) =>
  gen(async function* () {
    const response = yield* await tryPromise(
      () => fetch(url),
      () => upstream.unavailable({ status: 0 }),
    )
    if (!response.ok) {
      return yield* err(upstream.unavailable({ status: response.status }))
    }
    return yield* await tryPromise(
      () => response.json() as Promise<unknown>,
      (cause) => upstream.malformed({ reason: String(cause) }),
    )
  })
// Promise<Result<unknown, UpstreamUnavailable | UpstreamMalformed>>
```

`tryPromise` is the border checkpoint: its catch handler must produce a
tagged error, so the upstream's `TypeError`/`SyntaxError` never travels past
the boundary as itself.

The procedure does **not** re-export that granularity. Two upstream tags
would be noise in every component that renders a quote — the caller can't do
anything different with `unavailable` versus `malformed`. So the handler
collapses them with `mapError`, and only the coarse tag enters the contract:

```ts
// server/router.ts
import { error, gen, err, mapError, ok, wire } from "result-rpc"
import { safeJsonFetch } from "./services/rates"

const RatesUnavailable = error({
  tag: "rates/unavailable",
  data: wire.object({}),
  httpStatus: 503,
  retry: "transient",
})

const quote = app.procedure()
  .input(wire.object({ currency: wire.string }))
  .output(wire.object({ currency: wire.string, rate: wire.number }))
  .errors({ RatesUnavailable })
  .query(({ input, errors }) => gen(async function* () {
    const payload = yield* mapError(
      await safeJsonFetch(`https://rates.example/api/${input.currency}`),
      () => errors.RatesUnavailable({}),   // two granular tags → one declared tag
    )
    const rate = (payload as { rate?: number }).rate
    if (typeof rate !== "number") return yield* err(errors.RatesUnavailable({}))
    return { currency: input.currency, rate }
  }))
```

The type system enforces the collapse: a handler returning an undeclared
`upstream/unavailable` is a compile error, and one smuggled at runtime is
sanitized to `server/internal`. Simplifying the union is not a style
suggestion — it is the only way past the `.errors()` gate.

On the client, nothing new to learn — it is the same flattened state every
query has, and the domain branch is exactly one tag wide:

```tsx
function Quote({ currency }: { currency: string }) {
  const quote = AppShell.useQuery(client.rates.quote, { currency })

  switch (quote.state) {
    case "pending": return <Skeleton />
    case "success": return <Rate value={quote.value.rate} />
    case "failure": return <RatesDown retry={quote.refetch} />
    // quote.error: RatesUnavailable — the upstream vocabulary never leaked
  }
}
```

That is the full journey: throwing `fetch` → `tryPromise` → granular service
union → `mapError` collapse at the procedure → declared contract → flattened
hook state. One algebra, and each boundary decides how much detail the next
one deserves. When hook-state code needs to hand a settled outcome to
Result-typed code, `toResult(quote)` re-wraps it.

## Composition between layers

Layer middleware resolves to a Result, so `gen` composes there too — the
layer's declared union is the gate, exactly like a procedure's:

```ts
const session = defineLayer({
  name: "session",
  key: "viewer",
  provides: ViewerCodec,
  errors: { SessionExpired, SessionRevoked },
})

const sessionMiddleware = session.middleware(app, ({ context, errors }) =>
  gen(async function* () {
    const token = yield* readToken(context.headers, errors)    // Result<Token, SessionExpired>
    const viewer = yield* await lookupViewer(token, errors)    // Result<Viewer, SessionRevoked>
    return viewer
  }),
)
```

Everything downstream of the middleware sees `context.viewer` as guaranteed;
the failure paths travel the layer's union to the client, where the layer's
shell claims them. Composition on the server, subtraction on the client —
the same union both times.

## Credit and deliberate omissions

This surface ports the core DX of
[better-result](https://github.com/kitlangton/better-result) and
[neverthrow](https://github.com/supermacro/neverthrow), and happily credits
both. Three things are deliberately not ported:

- **Serialization helpers.** Wire safety is handled by this library's own
  concern — error `data` goes through declared codecs, rich values through
  the versioned serializer. A Result-level `toJSON` would be a second,
  weaker wire story.
- **`ResultAsync` / chained async wrappers.** `await` plus `gen` covers the
  composition; a wrapper class would add a second calling convention to
  every API that touches a promise.
- **`getOrThrow`.** Re-throwing is the pattern the rest of the library
  exists to retire. Where you genuinely want to crash on `Err` (scripts,
  tests), `if (!result.ok) throw result.error` is one honest line.

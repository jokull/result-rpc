# result-rpc: research synthesis and revised design

Working premise: one library owns the Result algebra, procedure implementation,
wire protocol, generated client, reactive query cache, and UI query API. Recoverable
failures are tagged wire values. There is no public trailing `| Error` and no
`Result` hidden inside successful query data while transport errors live elsewhere.

## Research snapshots

Research was performed against clean, current `main` checkouts on 2026-07-22:

| Project | Commit | Relevant prior art |
| --- | --- | --- |
| better-result | `0d1d792f4e409cf08cbee1a10a64ec951636577f` (v2.10.0) | Result composition, generator inference, tagged matching |
| tRPC | `340811ba5320637fbaf48fccf3dbfdd258bd34db` | Mature RPC lifecycle, batching, links, TanStack Query integration |
| oRPC | `428ad93edc4a718783f9cabda82cce0b10d155e5` | Per-procedure error maps, middleware error composition, schema-shaped error data |

## What overlaps, and where each abstraction stops

### 1. All three describe part of the same algebra

- better-result accumulates `E | E2` well through `andThen`, `flatten`, and
  generators, but places no transport constraint on `E`.
- tRPC transports failures robustly, but procedures have no individual error
  contract. Every endpoint gets the router-wide `TRPCClientError` shape.
- oRPC has the closest model: procedure and middleware error maps accumulate into
  endpoint-specific `ORPCError<Code, Data>` unions. It still appends
  `ThrowableError`, which defaults to `Error`.

The missing abstraction is a *closed operation failure union* that is accumulated
by server composition and expanded by each client-side boundary.

```ts
type CallError<P> =
  | GlobalErrors<P>
  | MiddlewareErrors<P>
  | ProcedureErrors<P>
  | TransportErrors
  | ProtocolErrors
```

No open `Error`, `unknown`, or string is part of this public union.

### Why gluing the three libraries together is insufficient

An integration package could improve ergonomics, but it could not make the core
invariants true. Each dependency would remain authoritative over a different and
incompatible failure boundary:

- better-result permits arbitrary error values and only shallowly unwraps its
  outer Result for “serialization”;
- tRPC owns an open thrown transport channel with a router-wide error shape;
- TanStack Query owns a rejecting query function and exposes `data | error` state.

Glue can translate at those seams, but cannot remove them. It would need to wrap or
override Result construction, procedure declarations, server exception handling,
wire encoding, client decoding, retry classification, cache settlement, observer
projection, dehydration, and cancellation. At that point the integration layer is
already the real framework while the three underlying public models remain escape
hatches.

result-rpc therefore replaces all three at the public contract level:

1. it incorporates the useful Result composition algebra rather than depending on
   better-result;
2. it owns the RPC builder, protocol, server runtime, and client rather than wrapping
   tRPC;
3. it owns the query/mutation/subscription API rather than returning TanStack Query
   observer objects.

A first implementation may use `@tanstack/query-core` privately as a cache and
scheduler engine. That is an implementation detail behind result-rpc's types and
state machine, not an adapter users compose themselves. It can later be replaced
without changing the public API. Reusing the engine initially avoids rebuilding
focus/online management, garbage collection, invalidation, retries, hydration, and
observer coordination before the error model is proven.

### 2. “Tagged” and “wire-safe” are separate properties today

better-result's `TaggedError` accepts `Record<string, unknown>`, subclasses
`Error`, copies arbitrary properties, and emits causes and stacks from `toJSON`.
Its static guards use `instanceof`, so they fail after JSON transport and across
realms. See `/Users/jokull/Forks/better-result/src/error.ts:13-129`.

oRPC validates declared error data, but an invalid or undeclared `ORPCError` can
still cross the wire as a non-inferable error. Its `defined` and `inferable`
booleans are transmitted and reconstructed, and client narrowing trusts the
wire-supplied `inferable` value. See:

- `/Users/jokull/Forks/orpc/packages/client/src/error.ts:41-147`
- `/Users/jokull/Forks/orpc/packages/client/src/error-utils.ts:6-49`
- `/Users/jokull/Forks/orpc/packages/contract/src/error-utils.ts:15-76`

A declaration in result-rpc is both a TypeScript contract and authorization to
cross the boundary. Unknown tags and invalid payloads are never forwarded.

### 3. `serialize()` must mean actual encoding, not outer wrapping

better-result's `Result.serialize` only changes:

```ts
Ok(value)  -> { status: "ok", value }
Err(error) -> { status: "error", error }
```

The payload references are unchanged and unconstrained. `deserialize<T, E>` checks
only the outer status and then asserts caller-provided types. A tagged error loses
its prototype and guards after JSON; `Date` changes type; `BigInt` throws; and an
object property containing `undefined` disappears. See
`/Users/jokull/Forks/better-result/src/result.ts:433-476` and its limited round-trip
tests at `src/result.test.ts:1636-1737`.

tRPC has the analogous distinction between a configurable transformer and the
actual JSON transport. Its static `Serialize<T>` does not prove that a runtime
value is encodable, and custom error formatter output is not runtime-validated.

result-rpc therefore has no shallow API named `serialize`. Encoding is owned by
the boundary and means all of:

1. validate the known tag;
2. encode its payload into the canonical wire grammar;
3. enforce serializer compatibility and encoded resource limits;
4. decode and validate again before exposing the typed client value.

### 4. Error classes are useful locally and harmful canonically

Both better-result and oRPC make errors `Error` subclasses. oRPC even needs a
global constructor registry and custom `Symbol.hasInstance` to survive duplicate
Next.js dependency graphs (`packages/client/src/error.ts:110-135`). That is strong
evidence that prototype identity should not define a remote value.

The canonical error should be an immutable structural DTO. Stack, cause, request,
and database details belong in server observability. The public internal error
contains only safe fields such as an opaque incident ID.

### 5. A Result in query data creates the exact two-tier failure model

tRPC and oRPC query functions return `T` or reject. Their TanStack adapters preserve
TanStack's `data: T | undefined` and `error: E | null` model. If `T` itself is
`Result<Value, DomainError>`, the UI receives:

```ts
data: Result<Value, DomainError> | undefined
error: TransportOrFrameworkError | null
```

Treating `Err` as successful query data also disables or distorts retries,
`failureCount`, paused-network behavior, error boundaries, and failed-query cache
semantics.

The adapter should instead reject tagged failures *internally* so TanStack Query
can do its job, then project the observer state into one public `Result` channel.
The cache contains successful `T`, not `Result<T, E>`.

One subtle case must remain visible: a background refetch may fail while cached
data remains usable. A single bare `Result<T, E>` cannot express both facts. The
failure state therefore carries `previous`, not a second operation error channel.

### 6. Infrastructure failures need stable, separate tags

tRPC collapses server envelopes, fetch rejection, abort, malformed JSON, and
transformer failures into `TRPCClientError`; its React Query-facing structural
type omits the cause and transport metadata needed to classify them. Its HTTP
requester attempts JSON regardless of `response.ok`, so an HTML 502 often looks
like a JSON parse failure.

oRPC keeps transport failures as ordinary `Error`s. Its timeout is an untagged
abort and its TanStack adapter has the same `data/error` surface.

result-rpc classifies in this order:

1. cancellation sentinel: control flow, never a public failure;
2. confirmed timeout;
3. browser-known offline state plus a failed/blocked attempt;
4. fetch/network failure;
5. non-success HTTP response without a valid result-rpc envelope;
6. malformed protocol envelope;
7. known tag with payload decode failure.

Suggested built-ins:

```ts
type ClientBoundaryError =
  | Tagged<"client/offline", {}>
  | Tagged<"client/network-failure", { retryable: boolean }>
  | Tagged<"client/timeout", { timeoutMs: number }>
  | Tagged<"client/http-failure", { status: number }>
  | Tagged<"client/protocol-violation", { reason: ProtocolReason }>
  | Tagged<"client/decode-failure", { target: "success" | "error" }>
```

Do not put response bodies, headers, raw thrown values, or URLs containing secrets
inside these errors.

### 7. HTTP status, retry policy, and tags are related but not identical

tRPC maps all 500-504 errors to the same JSON-RPC numeric code, making reverse
classification and retry policy lossy. oRPC derives status from its error code,
but will still transmit undeclared codes and invalid error data.

Each declared tag should own policy metadata at the definition site:

```ts
{
  httpStatus: 404,
  retry: "never",
  visibility: "public",
  severity: "info",
}
```

The tag remains the semantic identity. HTTP status is a transport projection.
A declared application `service/unavailable` is distinct from an intermediary
returning an HTML 503, even if both use the same HTTP status.

There must be one retry owner. With TanStack Query, the query layer owns ordinary
request retry. Lower transport retry is reserved for resumable streams or an
explicitly selected non-Query client policy; the two must never stack silently.

### 8. Cancellation, defects, and recoverable failures are different things

“Every error is tagged” applies to the public recoverable failure algebra.

- Cancellation is control flow. It must not be cached, rendered, retried, or
  logged as an operation failure.
- A server defect is caught at the outer RPC boundary, logged with its original
  cause, and converted to a sanitized `server/internal` tagged value.
- A client invariant/configuration defect may reject/crash rather than pretend to
  be a recoverable domain outcome. It is not exposed as `Error` in a public union.

This avoids better-result's second public-ish `Panic` channel while still refusing
to hide programmer bugs behind `NetworkFailure` or `Internal`.

### 9. Lifecycle state is not an error union

Offline-paused queries, reconnecting subscriptions, stream resumption, fetching,
and stale cached values are lifecycle states. They should not automatically become
terminal `Err` values. In particular, TanStack's `fetchStatus: "paused"` should
remain `paused`; produce `client/offline` only if the configured policy settles an
attempt as a failure.

Batch-level transport failure can be projected to the same client tag for every
affected operation, with a safe batch/request ID for correlation. Per-operation
declared errors remain independent.

SSR and direct server callers should default to wire-equivalent semantics. An
explicit unchecked in-process client may skip encode/decode for performance, but
must have a visibly different name because it can otherwise accept values that the
remote client rejects.

## Revised design

### Versioned transparent wire serialization

Successes and errors use the same pinned, protocol-versioned devalue transport. It
preserves `undefined`, non-finite numbers, `-0`, `Date`, `BigInt`, `RegExp`, maps,
sets, URLs, array buffers, typed arrays, cycles, and repeated identity.

Devalue's package format is explicitly not stable across releases, so result-rpc
owns a separate serializer version and pins the implementation. The first release
has one fixed profile; any future custom reducers/revivers must be paired and
introduced as a new versioned codec profile.

Functions, symbols, promises embedded in settled values, and unsupported class
instances are rejected. Error construction performs an actual serializer preflight;
a TypeScript type or schema alone cannot claim wire safety.

### Error definitions

An error definition is a callable factory plus a runtime wire codec and policy.
The value it creates is a frozen plain object:

```ts
const DocNotFound = error({
  tag: "doc/not-found",
  data: wire.object({ docId: wire.string }),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
})

const failure = DocNotFound({ docId: "doc_123" })
// Readonly<{ _tag: "doc/not-found"; data: { docId: string } }>
```

Properties:

- `_tag` is globally namespaced and literal.
- `data` is always present; no-payload errors use `{}`.
- `message`, if needed by the UI, is explicitly part of the declared data schema.
- definitions reject duplicate tags during router composition;
- `.is(value)` is structural decoding, never `instanceof`;
- no cause, stack, methods, iterator, or `toJSON` exists on the value.

### Result representation and composition

Use a plain discriminated union:

```ts
type Result<T, E extends AnyTaggedError> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>
```

Standalone combinators preserve better-result's best type behavior:

```ts
andThen: Result<A, E1> -> (A -> Result<B, E2>) -> Result<B, E1 | E2>
mapError: Result<A, E1> -> (E1 -> E2) -> Result<A, E2>
matchError: exhaustive over E["_tag"]
```

Generator syntax may yield a `Result` wrapper, but errors themselves remain plain
wire values. Direct `yield* error` is deliberately unsupported because it requires
putting `Symbol.iterator` on the error DTO.

There is no public `Result.serialize`. The RPC codec encodes and decodes envelopes;
tests assert the actual byte/JSON round doc.

### Procedure contract and composition

The declared map is authoritative:

```ts
const authenticated = rpc.middleware()
  .errors({ Unauthorized })
  .use(/* ... */)

const getDoc = rpc.procedure()
  .use(authenticated)
  .input(GetDocInput)
  .output(Doc)
  .errors({ DocNotFound })
  .query(async ({ input, errors }) => {
    const doc = await findDoc(input.id)
    if (!doc) return err(errors.DocNotFound({ docId: input.id }))
    return ok(doc)
  })
```

The handler's error type is exactly the composed declaration:

```ts
Result<Doc, Unauthorized | DocNotFound>
```

Middleware maps merge into procedure maps. Tag collisions are errors unless the
same definition identity is reused; silent local override is too dangerous for a
wire contract. Contract-first handlers cannot widen the contract by returning a
new tagged value. Runtime undeclared tags or invalid data are logged and replaced
by `server/internal`.

Unknown thrown server values follow the same sanitized path:

```ts
Tagged<"server/internal", { incidentId: string }>
```

Its HTTP status is 500 and its public text is fixed. The original message, cause,
and stack stay in logs.

### Protocol

Conceptual envelopes:

```ts
type SuccessEnvelope<TWire extends WireValue> = {
  ok: true
  value: TWire
}

type FailureEnvelope = {
  ok: false
  error: {
    _tag: string
    data: WireValue
  }
  incidentId?: string
}
```

The decoder does not trust a transmitted “defined” or “inferable” flag. It:

1. validates the envelope;
2. looks up the tag in the endpoint's composed registry plus framework registry;
3. decodes data with that tag's codec;
4. only then returns the typed variant.

An unknown tag is `client/protocol-violation`; known tag with bad data is
`client/decode-failure`. Hostile payloads are not copied into either error.

### Core client

The safe client is the default and always resolves recoverable outcomes:

```ts
client.doc.get(input): Promise<
  Result<
    Doc,
    Unauthorized |
    DocNotFound |
    ServerInternal |
    ClientBoundaryError
  >
>
```

This is where the client boundary expands the server-declared union. There is no
`TRPCClientError`, `ThrowableError`, or ambient `Error` escape hatch.

An optional throwing facade can unwrap this for integration with libraries that
use rejection as control flow, but it throws the same structural tagged value and
does not change the type algebra.

### Reactive query runtime

Internally:

```ts
const queryFn = async () => {
  const result = await client.doc.get(input)
  if (!result.ok) throw result.error
  return result.value
}
```

The query engine caches `Doc`, retries tagged transient failures, pauses work,
counts failures, and supports error boundaries. An initial implementation can map
this onto private `@tanstack/query-core` primitives.

The public hook removes `data | error` and projects one operation result:

```ts
type ResultQueryState<T, E> =
  | {
      state: "pending"
      result: undefined
      fetch: "fetching" | "paused"
    }
  | {
      state: "success"
      result: { ok: true; value: T }
      fetch: "idle" | "fetching" | "paused"
    }
  | {
      state: "failure"
      result: { ok: false; error: E }
      previous?: T
      fetch: "idle" | "fetching" | "paused"
    }
```

`previous` represents stale cached success after a failed refetch; it is not a
second error channel. Query controls such as `refetch`, timestamps, failure count,
and status predicates remain available, but raw query-core `data` and `error` are
not part of the public surface.

Retry defaults dispatch on definition policy:

- domain/auth/validation/not-found: never;
- timeout/network/selected 5xx: bounded exponential retry;
- rate limit: respect declared retry-after data;
- offline-paused: no attempt until resumed;
- protocol/decode: never;
- cancellation: handled by TanStack control flow, never surfaced as `Err`.

Mutations use the same projection. Subscriptions use a separate connection state
plus terminal `Result`, because reconnecting is not a terminal operation error.

### Minimum proof obligations for an MVP

1. Compile-time tests reject non-tagged procedure errors and non-wire error data.
2. Byte-level round docs cover every built-in and declared error.
3. Unknown tags, invalid data, unsupported serialized values, excessive encoded
   size, and hostile server payloads become sanitized protocol/decode tags.
4. An undeclared server error never crosses the wire.
5. Unknown server throws never expose their message, cause, or stack.
6. Query tests cover initial failure, retry, pause/resume, cancellation, background
   refetch failure with `previous`, dehydration, and hydration.
7. Batch tests distinguish shared transport failure from independent procedure
   failures.
8. Direct server clients pass through the same codec in parity mode.

## Product boundary

This is not a glue package, another general-purpose Result library, a thin tRPC
error formatter, or a TanStack Query options generator. It is one vertically
integrated replacement whose distinct contract is:

> A wire-first Result, RPC, and reactive query stack where the complete recoverable
> failure algebra is checked, encoded, decoded, accumulated, cached, and
> exhaustively matchable from middleware to UI.

The closest existing foundation is oRPC's composable error map. The essential
difference is making that map exhaustive and authoritative at runtime, using plain
wire values instead of error classes, adding client infrastructure tags to the
same closed union, and owning a single public Result query state without sacrificing
the mature cache semantics that can initially be supplied by query-core.

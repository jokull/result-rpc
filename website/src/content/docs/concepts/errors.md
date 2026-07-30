---
title: "Errors"
description: "Namespaced tagged errors with wire codecs and policy \u2014 declared once, shared by both sides, registered by the router."
---

Throwing `TRPCError({ code: "NOT_FOUND" })` for an anticipated outcome routes
that branch through a shared exception channel rather than making it part of
the procedure's exact return type. A custom formatter can enrich the channel,
but the caller still does not receive a closed, procedure-specific `E` union.

Here an error is a definition: a namespaced tag, a wire codec for its data,
and its policy (HTTP status, retry, visibility) — declared once, shared by
both sides:

```ts
import { error, wire } from "result-rpc";

export const DocNotFound = error({
  tag: "doc/not-found",
  data: wire.object({ docId: wire.string }),
  httpStatus: 404,
});

export const Unauthorized = error({ tag: "auth/unauthorized", httpStatus: 401 });

export type DocNotFound = ReturnType<typeof DocNotFound>;
export type Unauthorized = ReturnType<typeof Unauthorized>;
```

Or declare a whole namespace at once — keys become tags, so the tag string is
never written twice and cannot drift from the name:

```ts
export const docErrors = defineErrors("doc", {
  notFound: { data: wire.object({ docId: wire.string }), httpStatus: 404 },
  locked: { data: wire.object({ lockedBy: wire.string }), httpStatus: 409 },
});

docErrors.notFound({ docId }); // TaggedError<"doc/not-found", { docId: string }>
```

The key→tag rule is mechanical: camelCase keys become kebab-case tag
segments under the namespace — `notFound` → `doc/not-found`, `titleTaken` →
`doc/title-taken`. Shells index definitions by tag and tests assert tags, so knowing the
derivation beats guessing it at a distance.

Public definitions use the same map shape everywhere: procedure `.errors()`,
middleware `.errors()`, and shell `claims:` all take a map of definitions, so
one exported map is declared once and reused on both sides of the wire.
`pickErrors(docErrors, "locked")` selects the subset a procedure actually
declares. Grouping is always by these values, never by matching on the tag
string — the namespace prefix exists only so tags stay unique and readable.
Four namespaces are reserved for the framework's own errors: `client/`,
`server/`, `protocol/`, and `control/`; `error()` rejects tags that use them.

`retry` defaults to `"never"`, `visibility` to `"public"`, and `data` to an
empty object codec. Data-free definitions are called with no arguments:
`Unauthorized()`. `httpStatus` is an optional HTTP-adapter projection; when
omitted, the HTTP adapter carries the application failure in a neutral 200 RPC
envelope. When supplied, it accepts the common vocabulary by name —
`"not-found"`, `"conflict"`, `"too-many-requests"` — or any 4xx/5xx number.

Calling a definition creates the complete error value:

```ts
const failure = DocNotFound({ docId: "doc_123" });

failure instanceof Error; // true
DocNotFound.is(failure); // true
failure.name; // "doc/not-found"
failure.data.docId; // "doc_123"
failure.visibility; // "public"
failure.toJSON(); // { _tag: "doc/not-found", data: { docId: "doc_123" } }
```

The definition is the runtime identity and the namespaced tag is its portable
wire identity. A shape-compatible object is intentionally insufficient:

```ts
err({ _tag: "doc/not-found", data: { docId: "doc_123" } });
//  ^ type error — not a reified TaggedError
```

Each definition creates its own `TaggedError` subclass. On the server,
`DocNotFound.is(value)` verifies that exact definition's instance. Across the
wire, result-rpc downgrades the instance to its canonical `{ _tag, data }`
form, validates the tag against the procedure registry, decodes `data`, and
constructs a fresh instance from the same definition on the client:

```ts
const result = await client.doc.byId({ id: "missing" });

if (!result.ok && DocNotFound.is(result.error)) {
  result.error instanceof Error; // true, after the wire
  result.error.data.docId; // string
}
```

The client instance is faithful, not literally the server object: server
stack and cause are never transmitted. HTTP status and retry behavior remain
projections of the definition's identity. There is no public shallow
`Result.serialize()` — values cross the RPC boundary only through the
definition's actual encoder and decoder.

## Expected failures and unexpected exceptions

Expected failures are part of the contract. Unexpected exceptions are not.
If a caller can anticipate an outcome and make a useful decision from it,
return the declared tagged value through explicit control flow:

```ts
if (!doc) return err(errors.DocNotFound({ docId }));
```

Throwing that same outcome is not an alternate encoding. An exception escapes
the handler's declared `Result`, so the server boundary treats it as
unexpected: the private cause is sent to `onInternalError`, correlated with an
incident ID, and projected to the client as a sanitized `server/internal`.

```ts
throw new Error("database connection disappeared");
// server observability: original cause + incident ID
// client Result: ServerInternal({ incidentId })
```

This keeps the two paths useful. Declared failures produce structured Result
events suitable for product metrics, retries, and UI ownership. Unexpected
exceptions remain high-signal incidents with their causes available only on
the server. Throwing is still used for programmer errors, cancellation,
deliberate boundary escalation, and failures that were not adopted into a
declared domain error.

Use `tryPromise` at a throwing dependency boundary when the failure is an
anticipated part of the operation. Its catch mapper must construct a tagged
error, making the decision to expose, fold, or keep a provider failure private
visible in code.

## Public and private errors

Visibility is part of the definition and the resulting instance type. Omitted
means `"public"`. Use `visibility: "private"` for server-only failures that are
valuable while composing `Result`s but unsafe or meaningless as client API:

```ts
const UniqueConstraint = error({
  tag: "db/unique-constraint",
  data: wire.object({ constraint: wire.string }),
  visibility: "private",
});

r.procedure().errors({ UniqueConstraint });
//                    ^ type error: private errors cannot enter an RPC contract
```

Fold that failure into a public domain error before returning from the handler.
Private definitions cannot declare `httpStatus`; the public error owns that
projection if it needs one.
The type boundary covers procedures, middleware, and layers. Runtime
sanitization remains as defense in depth for JavaScript and unsafe casts.
Visibility is not a tree-shaking annotation: define private adapters in a
server-only module so their database or vendor imports never enter the client
bundle graph.

## The client-wide public union

Every client carries a flattened, `_tag`-discriminated union of all public
domain and framework errors in its contract:

```ts
import type { ClientErrors } from "result-rpc/client";

type AppError = ClientErrors<typeof client>;

if (client.$errors.is(unknownFailure)) {
  unknownFailure satisfies AppError;
  unknownFailure.visibility; // "public"
}

client.$errors.definitions; // runtime registry of the same public definitions
```

This is derived from the contract. Private definitions are absent by type, and
the client never trusts a visibility claim sent by the server.

This guarantee belongs to the result-rpc wire. `JSON.parse(JSON.stringify(error))`
produces the canonical plain representation, not another instance;
`DocNotFound.is(...)` correctly returns `false` until `DocNotFound.decode(...)`
upgrades it again. The same warning applies to framework RPC systems and
component-prop serializers that know nothing about the result-rpc contract.

## Result is total — partial availability is a value

`Result<T, E>` cannot say "the doc loaded, but its author panel is
unavailable." That is deliberate. GraphQL spent a decade with nullable
fields as ambient partial failure and is now retrofitting field-level error
semantics (Relay's `@catch`/`@throwOnFieldError`) — a directive on the
_query_, deciding per call site how much failure to tolerate.

Here the same fact is modeled where every other fact lives: in the output
type. If a field can be independently unavailable, say so in the schema —

```ts
.output(wire.object({
  doc: DocView,
  author: wire.union([
    User.pick("id", "name", "avatarUrl"),
    wire.object({ unavailable: wire.literal(true) }),
  ]),
}))
```

— and the component branches on a value, exhaustively, like everything
else. The operation still resolves one Result: the _call_ succeeded, and
"the author service was down" is part of what it successfully learned. No
directive vocabulary, no per-call-site tolerance policy, no nullable-means-
maybe-failed ambiguity: a partial outcome is a declared shape on the wire,
visible in the contract diff like any other API decision.

## The router is the error registry

One tag maps to exactly one definition across the whole application. Two
procedures reusing a tag must share the definition — the same reference — and
`server.router(...)` rejects a tag redeclared with a different definition at
build time. This is what makes tags safe as global registry keys: a shell uses
the tag to find a candidate and the exact definition to prove ownership, so a
tag can never mean two different things in one app. The
registry is inspectable at runtime:

```ts
// tag → definition. Keyed by `string`: this is the map the client decodes
// against and a devtools panel can enumerate, not a typed lookup.
appRouter.errors;
```

TypeScript catches incompatible duplicate declarations when their tag, codec,
or visibility types differ. It cannot mint a fresh nominal type for each call,
so two separate `error()` calls with exactly the same structural signature are
indistinguishable statically. Router construction therefore always performs
the final reference-identity check. Share exported definition constants; do
not redeclare a tag and rely on structural equality.

The key stays `string` on purpose. `ReadonlyMap` is invariant in its key type,
so narrowing it to the tag union would make a concrete router stop satisfying
`AnyRouter` — the erased runtime bound every function here accepts. For
compile-time exhaustiveness over declared errors, reach for
[`errorCatalog`](/concepts/client/) instead; that is
the typed door, and this is the runtime window.

## Retry policy follows the tag

Retry behavior is declared with the error rather than reconstructed from a
message or overlapping status code:

```ts
export const ServiceUnavailable = error({
  tag: "search/service-unavailable",
  httpStatus: 503,
  retry: "transient",
});

export const RateLimited = error({
  tag: "search/rate-limited",
  data: wire.object({
    retryAfterMs: wire.integer({ min: 0, max: 60_000 }),
  }),
  httpStatus: 429,
  retry: "after",
});
```

**Mutations are stricter by default.** A query retries `transient` and
`after` tags freely — reads are idempotent. A mutation whose connection
died mid-flight is _ambiguous_: the server may have processed it, and a
blind retry is the double-side-effect bug. So by default a mutation retries
only two failures: `client/offline` (the transport short-circuits before
sending — the request provably never left the client) and policy
`retry: "after"` (the server responded and scheduled the retry, so it chose
not to process the attempt). Everything else — network failure, timeout,
5xx — surfaces immediately. Idempotent mutations can opt back in with
`retry:`; idempotency keys are the roadmap item that will make full retry
the safe default. The `retryable` field on `client/network-failure` means
"provably never left the client" — and a fetch rejection cannot prove
that, so it is honest and `false`.

The query runtime owns query retry. A transport retry loop does not silently
run underneath it. Direct calls can opt into the same policy:

```ts
const result = await client.search.run(input, {
  retry: "from-error-policy",
});
```

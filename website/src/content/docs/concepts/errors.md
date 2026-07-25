---
title: "Errors"
description: "Namespaced tagged errors with wire codecs and policy \u2014 declared once, shared by both sides, registered by the router."
---

The footgun this replaces: `new TRPCError({ code: "NOT_FOUND", cause })` —
a string code from a fixed vocabulary, a `cause` that dies at the wire, and a
client that switch-matches on `error.data?.code` with no exhaustiveness and no
payload types.

Here an error is a definition: a namespaced tag, a wire codec for its data,
and its policy (HTTP status, retry, visibility) — declared once, shared by
both sides:

```ts
import { error, wire } from "result-rpc"

export const DocNotFound = error({
  tag: "doc/not-found",
  data: wire.object({ docId: wire.string }),
  httpStatus: 404,
})

export const Unauthorized = error({ tag: "auth/unauthorized", httpStatus: 401 })

export type DocNotFound = ReturnType<typeof DocNotFound>
export type Unauthorized = ReturnType<typeof Unauthorized>
```

Or declare a whole namespace at once — keys become tags, so the tag string is
never written twice and cannot drift from the name:

```ts
export const docErrors = defineErrors("doc", {
  notFound: { data: wire.object({ docId: wire.string }), httpStatus: 404 },
  locked: { data: wire.object({ lockedBy: wire.string }), httpStatus: 409 },
})

docErrors.notFound({ docId })  // { _tag: "doc/not-found", data: { docId } }
```

The key→tag rule is mechanical: camelCase keys become kebab-case tag
segments under the namespace — `notFound` → `doc/not-found`, `titleTaken` →
`doc/title-taken`. Shells claim by tag and tests assert tags, so knowing the
derivation beats guessing it at a distance.

The returned map is the shape everything else accepts: procedure `.errors()`,
middleware `.errors()`, and shell `claims:` all take a map of definitions, so
one exported map is declared once and reused on both sides of the wire.
`pickErrors(docErrors, "locked")` selects the subset a procedure actually
declares. Grouping is always by these values, never by matching on the tag
string — the namespace prefix exists only so tags stay unique and readable.
Four namespaces are reserved for the framework's own errors: `client/`,
`server/`, `protocol/`, and `control/`; `error()` rejects tags that use them.

`retry` defaults to `"never"`, `visibility` to `"public"`, and `data` to an
empty object codec — a domain error is a tag and an HTTP status until it needs
more. Data-free definitions are called with no arguments: `Unauthorized()`.
`httpStatus` accepts the common vocabulary by name — `"not-found"`,
`"conflict"`, `"too-many-requests"` — or any 4xx/5xx number.

Calling a definition creates the complete error value:

```ts
const failure = DocNotFound({ docId: "doc_123" })

// Readonly<{
//   _tag: "doc/not-found"
//   data: { docId: string }
// }>
```

The tag is the identity. HTTP status and retry behavior are projections of
that identity for the relevant runtime. There is no `.serialize()` — values
cross a boundary only through their definition's actual encoder and decoder.

## Result is total — partial availability is a value

`Result<T, E>` cannot say "the doc loaded, but its author panel is
unavailable." That is deliberate. GraphQL spent a decade with nullable
fields as ambient partial failure and is now retrofitting field-level error
semantics (Relay's `@catch`/`@throwOnFieldError`) — a directive on the
*query*, deciding per call site how much failure to tolerate.

Here the same fact is modeled where every other fact lives: in the output
type. If a field can be independently unavailable, say so in the schema —

```ts
.output(wire.object({
  doc: Doc.codec,
  author: wire.union([
    User.pick("id", "name", "avatarUrl"),
    wire.object({ unavailable: wire.literal(true) }),
  ] as const),
}))
```

— and the component branches on a value, exhaustively, like everything
else. The operation still resolves one Result: the *call* succeeded, and
"the author service was down" is part of what it successfully learned. No
directive vocabulary, no per-call-site tolerance policy, no nullable-means-
maybe-failed ambiguity: a partial outcome is a declared shape on the wire,
visible in the contract diff like any other API decision.

## The router is the error registry

One tag maps to exactly one definition across the whole application. Two
procedures reusing a tag must share the definition — the same reference — and
`app.router(...)` rejects a tag redeclared with a different definition at
build time. This is what makes tags safe as global identities: shells claim by
tag alone, so a tag can never mean two different things in one app. The
registry is inspectable:

```ts
appRouter.errors  // ReadonlyMap<string, ErrorDefinition> — every declared tag
```

## Retry policy follows the tag

Retry behavior is declared with the error rather than reconstructed from a
message or overlapping status code:

```ts
export const ServiceUnavailable = error({
  tag: "search/service-unavailable",
  httpStatus: 503,
  retry: "transient",
})

export const RateLimited = error({
  tag: "search/rate-limited",
  data: wire.object({
    retryAfterMs: wire.integer({ min: 0, max: 60_000 }),
  }),
  httpStatus: 429,
  retry: "after",
})
```


**Mutations are stricter by default.** A query retries `transient` and
`after` tags freely — reads are idempotent. A mutation whose connection
died mid-flight is *ambiguous*: the server may have processed it, and a
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
})
```

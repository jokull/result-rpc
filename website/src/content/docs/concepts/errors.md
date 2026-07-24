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

The query runtime owns query retry. A transport retry loop does not silently
run underneath it. Direct calls can opt into the same policy:

```ts
const result = await client.search.run(input, {
  retry: "from-error-policy",
})
```

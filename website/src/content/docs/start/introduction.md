---
title: "Introduction"
description: "One Result and one wire-safe error union from server to screen \u2014 why the error channel is the architecture."
---

One Result. One error union. Server to screen.

result-rpc is an RPC layer for React in the tRPC tradition — contract in
TypeScript, procedures on the server, hooks in components — with one structural
change: every way an operation can fail is a typed, wire-safe value in that
operation's own closed union, and responsibility for each failure is assigned
to exactly one place in the component tree.

It is built as the migration path for the tRPC app that grew up. There is a
day when offline behavior, 5xx handling, session expiry, and observability
stop being polish and become the work — and you find yourself threading them
through every query and mutation, or bolting them on with `onError` defaults,
axios-style interceptors, and a Sentry integration that guesses at what
happened. That day, the error channel *is* the architecture. result-rpc is
that channel designed on purpose: the corner cases are first-class values with
first-class owners, and observability is a structured stream you tap, not a
reconstruction.

If you looked at Effect for this and backed away, what's here is the subset
you wanted — typed errors, services, layers — at half the setup and a tenth of
the weirdness, with hooks that read like the ones you already write.

And if you already tried the halfway version — neverthrow or better-result on
the server, procedures returning `Result` as data — you know exactly where it
stops: tagged errors are not wire-safe, so the discipline dies at the
serializer, and on the client `query.error` is suddenly a different thing
from `query.data.error`. This library starts where that attempt ends. The
Result *is* the protocol.

```ts
const query = useResultQuery(client.doc.byId, { id: "doc_123" })

if (query.state === "failure") {
  // DocNotFound | Unauthorized | ServerInternal | Offline | NetworkFailure |
  // Timeout | HttpFailure | ProtocolViolation | DecodeFailure | Stale
  query.error
}
```

Ten tags looks like a lot until you notice they are not new failure modes —
they are the ones your stack already has, mostly unnamed. tRPC spreads them
across `error.data?.code`, `TRPCClientError.cause`, and unhandled fetch
rejections; result-rpc's union is the same reality, admitted, in one place,
closed. And no component has to
branch on all of it, because the same union is narrowed by what the tree
already takes responsibility for:

```ts
const query = AuthShell.useQuery(client.doc.byId, { id: "doc_123" })

if (query.state === "failure") {
  // DocNotFound
  query.error
}
```

Nothing was hidden. `Unauthorized` is gone because an enclosing shell
guarantees a session and redirects when that stops being true. The transport
tags are gone because the app shell owns the offline banner. The protocol tags
are gone because they escalate to an error boundary. Each shell subtracts
exactly what it takes responsibility for, and it does so in the type.

The pieces, in the order this document builds them:

1. **A wire contract** — procedures, codecs, and tagged errors declared once,
   shared by both sides; rich values survive the wire.
2. **Middleware and services** — request context that grows as middleware adds
   guarantees; process-lifetime resources resolved once as a dependency graph.
3. **A client** whose every call resolves `Result<T, ExactUnion>` — never a
   thrown transport error on the side.
4. **A Result-native query cache** — caching, retries, optimistic updates,
   SSR, all speaking Result.
5. **Shells** — error boundaries for values: providers that own classes of
   failure and subtract them from the unions components see.

Routing, SSR frameworks, and bundling are explicitly not on the list — shells
are providers and hooks, so they compose with whatever owns the tree.

> **Status**: pre-1.0. Everything documented here is implemented and tested —
> the `examples/` directory is runnable — but the package is not yet published
> to npm while the API settles.

## The two problems

## Problem one: two failure channels

You have written this component. Domain failures come back as data; transport
failures come back somewhere else:

```ts
const query = useQuery({
  queryFn: () => rpc.doc.byId.query({ id }),
})

query.data
// Result<Doc, DocNotFound | Unauthorized> | undefined

query.error
// TRPCClientError | null  — code buried in error.data?.code, cause stripped
```

Domain failures are *successful query data*. Network failures use the query
error channel. Retries, error boundaries, offline behavior, and exhaustive
matching now operate on different halves of the same operation — and the half
in `query.error` is stringly typed, because error classes do not survive the
wire.

Every good team patches this, and each patch is a known move:

- **Discipline.** Decree that `query.error` is transport-only and return a
  discriminated union as data. Now the cache's machinery — retries, error
  boundaries, offline pausing — operates on the half your domain errors are
  not in, exhaustive matching operates on the half your transport errors are
  not in, and every component maps every tag by hand, because nothing ever
  narrows.
- **Encoding.** superjson-encode the Result objects across the wire. You get
  Result-*shaped* JSON, not a contract: no closed union per procedure, no
  exhaustiveness, no retry or status policy attached to the error.
- **Interception.** A global `onError` callback on the client. That is
  problem two.

result-rpc makes the operation the unit of composition:

```ts
type GetDocError =
  | DocNotFound
  | Unauthorized
  | ServerInternal
  | Offline
  | NetworkFailure
  | Timeout
  | HttpFailure
  | ProtocolViolation
  | DecodeFailure
  | Stale
```

The shared contract declares server and middleware errors. The client boundary
adds transport and protocol errors. The query runtime preserves the full union
while handling caching, retries, pausing, hydration, and cancellation.

## Problem two: the 401 interceptor

A complete union is honest, but exhaustiveness is not relevance. A component
that renders a document has business with `DocNotFound`. It has no business
deciding what happens when the network is down or the session is revoked
mid-render.

`Unauthorized` is the halfway house that exposes this. It is domain-shaped —
declared, typed, expected by every procedure that requires a session — and it
is ambient: it can surface on any call, and no document component should
carry branching logic for what sign-out looks like. The domain bucket taxes
every component with it; the transport bucket makes it stringly. Neither
holds it — and it is not alone: plan limits, org suspension, maintenance
windows, read-only mode all have the same shape, declared like domain errors
but owned like infrastructure. So every app that survives contact with
production grows one of these:

```ts
// somewhere global, in every codebase, in some costume
queryClient.setDefaultOptions({
  queries: {
    onError: (error) => {
      if ((error as any)?.data?.httpStatus === 401) {
        window.location.href = "/login"
      }
    },
  },
})
```

A global, stringly hook, invisible to the type system, that fires once per
in-flight query, races the components' own error branches, and blanks whatever
the user was looking at. The disciplined version — a cache-level handler plus
per-query `meta` flags to suppress it on the login screen — is the same move
with more indirection, and it double-fires and races the same way. Both exist
because the alternative — handling session expiry in every component that
fetches — is worse.

The requirement the interceptor cannot express is that ownership depends on
*where you are*: the app shell should own `Unauthorized` almost everywhere,
while the one login-adjacent screen that wants to render it inline takes it
back. result-rpc keeps the union complete at the contract and replaces the
interceptor with a typed, tree-positional owner: a shell declares, in one
place, which tags it takes responsibility for, and those tags leave the union
every component beneath it sees — while a component rendered outside the
shell (or using the unnarrowed hook) sees the full union again. Handling a
tag or delegating it is a choice made by position, and the type at every call
site shows which choice is in force. That is the [Shells](/concepts/shells/)
section, and it is the reason the rest of the machinery exists.

## What result-rpc owns

| Concern | result-rpc contract |
| --- | --- |
| Result composition | Plain Result values, `gen`/`yield*`, `tryPromise`, union-preserving combinators, exhaustive matching |
| Error definitions | Namespaced tags, wire codecs, HTTP/retry/visibility policy |
| RPC | Procedures, middleware, routers, server execution, protocol, clients |
| Transport failures | Tagged additions to each procedure's inferred error union |
| Query runtime | Keys, caching, retries, invalidation, lifecycle, hydration |
| Failure ownership | Shells that subtract claimed tags and guarantee context |
| React | Query, mutation, subscription, suspense, and SSR bindings |
| Diagnostics | Safe incident IDs publicly; full causes only in local observability |
| Observability | Wire event stream, claim breadcrumbs, policy-aware server taps, Result taps |
| Cache coherence | Entity identities (patch by model+id), declared invalidation, membership via `.affects` |
| Forms | Validator-as-wire-codec adoption, plus server-issue → field projection |

The query engine uses `@tanstack/query-core` privately. That is an engine
choice, not part of the public API. Applications do not install or compose
better-result, tRPC, or React Query around result-rpc.

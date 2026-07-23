# result-rpc

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

```ts
const query = useResultQuery(client.doc.byId, { id: "doc_123" })

if (query.state === "failure") {
  // DocNotFound | Unauthorized | ServerInternal | Offline |
  // NetworkFailure | Timeout | HttpFailure | ProtocolViolation | DecodeFailure
  query.result.error
}
```

Nine tags looks like a lot until you notice they are not new failure modes —
every stack has all nine. tRPC spreads them across `error.data?.code`,
`TRPCClientError.cause`, and unhandled fetch rejections; result-rpc's union is
the same reality, admitted, in one place, closed. And no component has to
branch on all of it, because the same union is narrowed by what the tree
already takes responsibility for:

```ts
const query = AuthShell.useQuery(client.doc.byId, { id: "doc_123" })

if (query.state === "failure") {
  // DocNotFound
  query.result.error
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

### Problem one: two failure channels

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
```

The shared contract declares server and middleware errors. The client boundary
adds transport and protocol errors. The query runtime preserves the full union
while handling caching, retries, pausing, hydration, and cancellation.

### Problem two: the 401 interceptor

A complete union is honest, but exhaustiveness is not relevance. A component
that renders a document has business with `DocNotFound`. It has no business
deciding what happens when the network is down or the session is revoked
mid-render. So every app that survives contact with production grows one of
these:

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
the user was looking at. It exists because the alternative — handling session
expiry in every component that fetches — is worse.

result-rpc keeps the union complete at the contract and replaces the
interceptor with a typed, tree-positional owner: a shell declares, in one
place, which tags it takes responsibility for, and those tags leave the union
every component beneath it sees. That is the [Shells](#shells-error-boundaries-for-values)
section, and it is the reason the rest of the machinery exists.

## Install

```sh
npm install result-rpc
```

One versioned package, one entry per runtime — the root is everything
isomorphic (the contract language):

```ts
import { rpc, error, errorCatalog, err, ok, wire, defineLayer, defineService, resolveServices, type RouterInputs, type RouterOutputs } from "result-rpc"
import { createFetchHandler } from "result-rpc/server"
import { batchFetchTransport, createClient } from "result-rpc/client"
import { defineShell, layerShell, ResultRpcProvider, useResultQuery } from "result-rpc/react"
```

## Define errors once

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

The returned map is the grouping currency everything else takes — procedure
`.errors()`, middleware, shells, catalogs — and `pickErrors(docErrors,
"locked")` selects the subset a procedure actually declares. Grouping is by
value, not by string prefix: the namespace exists for human uniqueness and the
reserved framework carve-out, nothing else.

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

### The router is the error registry

One tag maps to exactly one definition across the whole application. Two
procedures reusing a tag must share the definition — the same reference — and
`app.router(...)` rejects a tag redeclared with a different definition at
build time. This is what makes tags safe as global identities: shells claim by
tag alone, so a tag can never mean two different things in one app. The
registry is inspectable:

```ts
appRouter.errors  // ReadonlyMap<string, ErrorDefinition> — every declared tag
```

## Define the shared contract

```ts
import { rpc, wire, type InputOf } from "result-rpc"
import { DocNotFound, Unauthorized } from "./errors"

interface AppContext {
  docs: DocRepository
  auth: AuthService
}

export const app = rpc.context<AppContext>()

const DocCodec = wire.object({
  id: wire.string,
  title: wire.string,
  savedAt: wire.date,
})
type Doc = InputOf<typeof DocCodec>

export const getDocContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(DocCodec)
  .errors({ Unauthorized, DocNotFound })
  .query()

export const appContract = app.contract({
  doc: {
    byId: getDocContract,
  },
})
```

One honest difference from tRPC: tRPC ships the router's *type* to the client
(`import type AppRouter`), and in exchange the client can neither decode rich
values nor validate anything. result-rpc ships a small *value* — the contract:
codecs, tags, and policies, no middleware or handler code, safe in any browser
bundle. It is the one place this library costs you a file tRPC doesn't, and it
is what pays for `Date`/`Map`/`BigInt` over the wire and codecs on both sides.

(When client and server share a process — SSR, tests, server components — you
can skip the split and hand `createClient` the router directly. Code-first
procedures with inline handlers work the same way; the contract split is for
the browser boundary, not a required style.)

## Implement the contract on the server

```ts
import { err, ok } from "result-rpc"
import { app, getDocContract } from "./contract"

export const getDoc = app
  .implement(getDocContract)
  .use(authenticated)
  .handler(async ({ input, errors, context }) => {
    const doc = await context.docs.find(input.id)

    if (!doc) return err(errors.DocNotFound({ docId: input.id }))

    return ok(doc)
  })
```

The handler must return the declared Result:

```ts
Result<Doc, Unauthorized | DocNotFound>
```

Returning a different tag is a type error. Smuggling an undeclared or
malformed tag at runtime does not make it public: result-rpc logs the defect
and emits a sanitized `server/internal` value.

## Middleware participates in the same union

The tRPC footgun here is quiet: middleware that throws `TRPCError({ code:
"UNAUTHORIZED" })` adds a failure mode the procedure's type never mentions.
Here, middleware declares what it contributes, and the contribution lands in
the union:

```ts
import { err } from "result-rpc"
import { app } from "./doc"
import { Unauthorized } from "./errors"

const authenticated = app
  .middleware<{ user: User }>()
  .errors({ Unauthorized })
  .use(async ({ context, errors, next }) => {
    const user = await context.auth.user()

    if (!user) {
      return err(errors.Unauthorized({}))
    }

    return next({
      context: { ...context, user },
    })
  })

export const getDoc = app
  .implement(getDocContract)
  .use(authenticated)
  .handler(/* ... */)
```

The procedure now returns:

```ts
Result<Doc, Unauthorized | DocNotFound>
```

Builders are immutable, so a base forks freely — the `protectedProcedure`
pattern is one line:

```ts
const protectedProcedure = app.procedure().use(authenticated)

const renameDoc = protectedProcedure
  .input(RenameInput)
  .output(DocCodec)
  .errors({ DocNotFound, DocLocked })   // only its own domain errors;
  .mutation(/* ... */)                     // the auth union rides in with the base
```

In contract-first code, middleware errors must already be present in the
shared contract; `app.implement(...).use(...)` rejects an undeclared
contribution. The code-first convenience form unions middleware definitions
automatically. Duplicate tags with different definitions are rejected rather
than silently overridden.

## Two kinds of context

A procedure sees one `context`, but two different things feed it, with
different lifetimes and failure rules:

| | Services | Request middleware |
| --- | --- | --- |
| Examples | database pool, worker bindings, API clients | session, viewer, organization |
| Lifetime | process | request |
| Shape | dependency graph | ordered chain |
| Can fail with a wire error | no — a broken service is a broken process | yes — failures join the operation union |
| Owned by | `defineService` / `resolveServices` | middleware |

### Services

If you have read about Effect: this is its service/dependency-injection idea
at its useful core — declare what each resource needs, resolve the graph once,
memoize by identity — without fibers, without `Effect.gen`, without a runtime.
It is a small feature, not a religion.

```ts
import { defineService, resolveServices } from "result-rpc"

const Db = defineService("db", {
  create: () => createPool(env.DATABASE_URL),
})

const Mailer = defineService("mailer", {
  needs: { db: Db },
  create: ({ db }) => createMailer(db),
})

const services = await resolveServices({ db: Db, mailer: Mailer })
```

The graph is resolved once at process start and memoized by definition
reference — a service two others depend on is constructed exactly once. The
sharp edge, stated plainly: identity is by reference, so store definitions in
module constants; two `defineService` calls are two services.

The resolved record becomes the root context that every request closes over:

```ts
export const handleRpc = createFetchHandler({
  router: appRouter,
  createContext: ({ request }) => ({ ...services, request }),
})
```

Nothing pulls services per call — the auth middleware reads `context.db`
because the root context guarantees it, and swapping the whole record for a
test double is one argument to `createContext`.

### Middleware composes by requirement, not by ordering

The footgun: middleware order as tribal knowledge — `session` must run before
`requireViewer`, enforced by a comment. Here a middleware declares what it
runs after; the dependency's output becomes its input, the dependency's errors
join the union, and any `.use()` site pulls the whole chain in dependency
order:

```ts
const session = app.middleware<{ viewer: User | null }>()
  .use(async ({ context, next }) =>
    next({ context: { ...context, viewer: await userFromCookie(context) } }))

const requireViewer = app.middleware<{ viewer: User }>()
  .after(session)                        // handler sees viewer: User | null
  .errors({ Unauthorized })
  .use(({ context, errors, next }) =>
    context.viewer === null
      ? err(errors.Unauthorized({}))
      : next({ context: { ...context, viewer: context.viewer } }))
```

A mutation then demands exactly one thing:

```ts
export const renameDoc = app.procedure()
  .input(RenameInput)
  .output(DocCodec)
  .use(requireViewer)                    // session comes along, in order
  .mutation(({ context, input }) =>      // context.viewer: User
    context.db.docs.rename(input, context.viewer))
```

`.use(session)` followed by `.use(requireViewer)` still runs `session` once —
composition is deduplicated by reference identity, the same rule as services
(module constants, not inline builds). A middleware whose input demands
context the procedure cannot supply is a type error, so requirements are
checked, not hoped for.

## Create the router and server

```ts
import { createFetchHandler } from "result-rpc/server"
import { app, getDoc } from "./doc"

export const appRouter = app.router({
  doc: {
    byId: getDoc,
  },
})

export type AppRouter = typeof appRouter

// Nested inference helpers mirror the router's shape — works on contracts too:
// type Inputs = RouterInputs<AppRouter>;  Inputs["doc"]["byId"]  → { id: string }
// type Outputs = RouterOutputs<AppRouter>; Outputs["doc"]["byId"] → Doc
// type Errors = RouterErrors<AppRouter>;   Errors["doc"]["byId"]  → declared union

export const handleRpc = createFetchHandler({
  router: appRouter,
  endpoint: "/rpc",
  createContext: ({ request }) => ({
    request,
    auth,
    docs,
  }),
  onInternalError: ({ incidentId, phase, cause, procedurePath }) => {
    logger.error({ incidentId, phase, cause, procedurePath })
  },
})
```

`onError` is the observability tap: it fires for every declared error that
crosses the wire — domain errors, bad requests, sanitized internals — with the
error value, its policy (severity, retry, status), and the procedure path, so
one hook feeds metrics and logging:

```ts
onError: ({ error, policy, procedurePath, httpStatus }) => {
  metrics.count(error._tag, { severity: policy?.severity })
}
```

Malformed input is the client's fault, not an incident: it becomes a public
`server/bad-request` (400) carrying path-and-message issues — never values —
while `onInternalError` stays reserved for genuine defects.

Unknown exceptions are logged with an incident ID. The client receives only:

```ts
{
  _tag: "server/internal",
  data: { incidentId: "inc_..." },
}
```

Exception messages, stacks, causes, queries, and response bodies are not
reflected over the wire.

## Call it directly

```ts
import { createClient, batchFetchTransport } from "result-rpc/client"
import { appContract } from "../shared/contract"

export const client = createClient({
  contract: appContract,
  transport: batchFetchTransport({ url: "/rpc" }),
})

const result = await client.doc.byId({ id: "doc_123" })
```

Calls issued in the same microtask share one HTTP request. Every batch item
keeps its own status, decoder, rich-value envelope, and tagged Result. Use
`fetchTransport` when batching is not wanted; the client API is unchanged.

The direct client is the honest base: it always resolves the complete union.
Narrowing is a property of where a call is *rendered*, and the direct client
is not rendered anywhere, so it never subtracts anything.

```ts
Result<
  Doc,
  | Unauthorized
  | DocNotFound
  | ServerInternal
  | Offline
  | NetworkFailure
  | Timeout
  | HttpFailure
  | ProtocolViolation
  | DecodeFailure
>
```

Handle the union with an ordinary switch (`result.error satisfies never` in
the default arm keeps it exhaustive), or build a reusable projection — a
message catalog, a metrics mapper — once, from the same definition map
middleware and shells use:

```ts
import { errorCatalog } from "result-rpc"

const message = errorCatalog({ DocNotFound, Unauthorized }, {
  "doc/not-found": (e) => `Doc ${e.data.docId} is gone`,
  "auth/unauthorized": () => "Sign in to continue",
})
```

Adding a definition to the map breaks every catalog missing the new tag. For
inline one-offs, `matchError(result.error, { ...handlers })` gives the same
exhaustiveness on a single value.

## Use it from React

Hand the provider your client; it owns a query runtime for its lifetime:

```tsx
import { ResultRpcProvider } from "result-rpc/react"
import { client } from "./client"

export function Providers({ children }: { children: React.ReactNode }) {
  return <ResultRpcProvider client={client}>{children}</ResultRpcProvider>
}
```

Pass an explicit `runtime` instead when the app needs the instance elsewhere —
SSR prefetching, imperative cache access.

Query a procedure:

```tsx
import { useResultQuery } from "result-rpc/react"
import { client } from "./client"

export function DocPage({ id }: { id: string }) {
  const doc = useResultQuery(client.doc.byId, { id })

  switch (doc.state) {
    case "pending":
      return doc.fetch === "paused"
        ? <OfflinePlaceholder />
        : <DocSkeleton />

    case "success":
      return (
        <DocView
          doc={doc.result.value}
          refreshing={doc.fetch === "fetching"}
        />
      )

    case "failure":
      return (
        <DocFailure
          error={doc.result.error}
          previous={doc.previous}
          retry={doc.refetch}
        />
      )
  }
}
```

There is no top-level `data | error` pair:

```ts
doc.result
// Ok<Doc> | Err<GetDocError> | undefined
```

The query engine still caches successful values, retries transient failures,
tracks failure counts, pauses offline work, and supports invalidation. It uses
its failure channel internally and projects it back into the public Result
state.

`useResultQuery` is the unnarrowed hook: it always yields the operation's
complete union. Application code normally reaches for a shell's hooks instead,
so that each part of the tree only presents the failures it is actually
responsible for — that is the next section.

For Suspense, use `useResultSuspenseQuery`. It suspends only while pending and
returns the same success-or-failure state after settlement; tagged failures
remain ordinary Result values rather than becoming a second thrown error type.

### Failed background refreshes preserve stale data

A refetch can fail while a cached value remains useful. That is represented
explicitly:

```tsx
if (doc.state === "failure" && doc.previous) {
  return (
    <>
      <DocView doc={doc.previous} stale />
      <RefreshFailure error={doc.result.error} />
    </>
  )
}
```

`previous` is cached success from an earlier attempt. It is not another error
channel.

### Offline is lifecycle before it is failure

When an operation is waiting for connectivity:

```ts
doc.fetch === "paused"
```

This does not consume a retry or immediately become `client/offline`. An
Offline error appears only if the configured policy settles an attempted
operation as a failure.

## Shells: error boundaries for values

Remember the 401 interceptor. Now recall that React already solved this exact
shape once, for a different kind of failure. Render errors used to be every
component's private problem; error boundaries made them *positional*: throw
anywhere below, and the nearest boundary that claims it takes over. Three
properties made that design stick:

1. **Tree-positional** — ownership follows the UI, not the call site.
2. **It catches errors from components that never heard of it** — a boundary
   that only caught opted-in throws would be useless.
3. **Unclaimed errors fail loudly** rather than vanish.

Nobody calls an error boundary "action at a distance." It is the contract.

A shell is the same contract, transplanted from thrown render errors to
failure *values*. A shell is a provider that claims a set of error tags. Any
operation rendered beneath it — no matter which hook issued it — that fails
with a claimed tag is routed to the shell instead of surfacing as component
state. The 401 interceptor becomes a typed declaration with a position in the
tree, and the tags it owns disappear from the unions below it.

### Three tiers of failure, three owners

The tiers are nothing more than which definition map you hand to which shell —
there is no classification field, and the framework ships the two maps you'd
otherwise assemble by hand:

| What failed | Example tags | Natural owner | The map |
| --- | --- | --- | --- |
| The domain said no | `doc/not-found`, `auth/unauthorized` | the component, or an auth shell | your `defineErrors` maps |
| The world flaked | `client/offline`, `client/timeout`, `client/network-failure` | an app shell with a banner | `transportErrors` |
| The contract broke | `client/protocol-violation`, `client/decode-failure`, `server/internal` | a React error boundary | `defectErrors` |

### Declare the shells

```tsx
import { defectErrors, transportErrors } from "result-rpc"
import { defineShell } from "result-rpc/react"
import { authErrors } from "../shared/errors"

export const AppShell = defineShell({
  name: "app",
  claims: transportErrors,          // effect defaults to "pause"
})

export const DefectShell = defineShell({
  name: "defect",
  from: AppShell,
  claims: defectErrors,
  effect: "escalate",               // becomes a throw, for the real boundary
})

export const AuthShell = defineShell({
  name: "auth",
  from: DefectShell,
  claims: authErrors,
  onError: (_error, { signOut }) => signOut(),
  provide: (props: { session: Session; signOut: () => void }) => ({
    user: props.session.user,
    signOut: props.signOut,
  }),
})
```

Mount them as an onion:

```tsx
<ResultRpcProvider runtime={runtime}>
  <AppShell.Provider>
    <DefectShell.Provider>
      <ErrorBoundary fallback={<AppBroken />}>
        <AuthShell.Provider session={session} signOut={signOut}>
          <Routes />
        </AuthShell.Provider>
      </ErrorBoundary>
    </DefectShell.Provider>
  </AppShell.Provider>
</ResultRpcProvider>
```

Inside `Routes`, an operation declaring nine tags presents one:

```tsx
export function DocPage({ id }: { id: string }) {
  const { user } = AuthShell.use()      // User, not User | null
  const doc = AuthShell.useQuery(client.doc.byId, { id })

  switch (doc.state) {
    case "pending": return <DocSkeleton />
    case "success": return <DocView doc={doc.result.value} viewer={user} />
    case "failure":
      // DocNotFound — and adding a case for anything else is a type error
      return <DocMissing docId={doc.result.error.data.docId} />
  }
}
```

### How claiming actually works

Claiming is **per observer and tree-positional**. Each hook, at its render
position, checks whether an enclosing shell claims the failure's tag. The
cache is never rewritten: the entry still holds the real `Err`, refetch
bookkeeping continues underneath, and an observer of the same cache entry
rendered *outside* the shell still sees `state: "failure"`. A shell changes
how a failure presents where it presents — nothing else. The innermost shell
claiming a tag owns it.

The type story has two halves:

- **Shell hooks subtract.** `AuthShell.useQuery` removes the chain's claimed
  tags from the union — and eagerly asserts, at mount, that every shell in
  the chain is actually mounted above it. The subtraction is only honest if
  the owners exist, so a missing provider throws on *first render*, the same
  contract as any context hook without its provider. You find out on the
  happy path in development, not on the error path in production.
- **Plain hooks over-approximate.** `useResultQuery` keeps the full union.
  Under a mounted shell, the claimed tags in that type are unreachable —
  the shell routes them — exactly the way a `try/catch` inside an error
  boundary lists exceptions the boundary would have caught anyway.
  Unreachable, not untrue; and outside any shell, the same type is exact.

Property 2 of error boundaries is why interception cannot be opt-in per hook:
if a plain hook under `AuthShell` could surface `auth/session-expired` as
component state, the shell's guarantee — and every narrowed union derived from
it — would be a lie. Ownership is positional or it is nothing.

To genuinely own a claimed tag yourself, render outside the shell that owns
it. That is not an escape hatch; it is the design. The login page lives
outside `AuthShell` and handles `auth/session-expired` as an ordinary failure,
because there is no session to guarantee there.

### The chain is a value, not an inference

`from:` makes the accumulated claim set a property of the shell value.
`AuthShell` is typed with its own claims plus everything `DefectShell` and
`AppShell` claim, and nobody writes that union by hand. Narrowing never
depends on TypeScript inferring where a component sits in the tree — you
cannot reach `AuthShell.useQuery` without importing the shell that declares
the chain, and the chain proves itself mounted at runtime.

Two invariants are enforced at definition time:

- a tag may be claimed **once** per chain — overlapping shells are a
  `TypeError` at startup, not a precedence puzzle later;
- claims only accumulate inward, so an inner shell can never un-handle
  something an outer shell took responsibility for.

### What a claimed error does to the operation

A subtracted error never produces `state: "failure"` — that would be a lie
about a union it is no longer in.

With `effect: "pause"` (the default):

- **Query** — returns to a non-terminal state with `fetch: "paused"`. If a
  cached success exists it keeps rendering as `state: "success"`, stale, so a
  session blip does not blank the screen. If not, `state: "pending"`.
- **Mutation** — state returns to `"idle"` and the pending `mutate` promise
  rejects with the *same control sentinel as `mutation.cancel()`*. This is
  cancellation semantics on purpose: the caller's continuation was written
  against the narrowed union, so an outcome owned above it must not run it —
  for the same reason an aborted request doesn't run your `.then`. A call
  site that awaits `mutate` handles it exactly like cancellation, which it
  already had to handle.
- **Subscription** — `connection` becomes `"paused"` and `result` stays
  `undefined`.

With `effect: "escalate"`, the tagged value is thrown to the nearest React
error boundary — as the structural `TaggedError`, not wrapped in an `Error`,
so the fallback can still `matchError` on it. Escalate is the bridge back to
the machinery React already has.

`onError` fires once per newly claimed error per observer. One logical event —
a revoked session — arrives on every in-flight operation at once, so handlers
must be idempotent (a redirect, a `signOut()`, a toast keyed by tag).

### The pause arc ends in resume

Held is not stuck. Every held operation carries a retry handle, and the shell
exposes the whole set:

```tsx
const { latest, affected, resume } = AuthShell.useHeld()
// after re-authenticating:
resume() // every held query refetches; held subscriptions reconnect
```

Held mutations stay idle — replaying a side effect is never the shell's call.

Layer shells (below) close the loop automatically: when the layer's context
procedure re-establishes its value (sign back in, invalidate `client.auth.me`),
every operation the shell was holding resumes without a line of app code.
Mid-session revocation therefore plays out as: refetch fails → shell holds it
→ the stale value keeps rendering → re-auth → held work refetches fresh. The
screen never blanks and no component ever branched on it.

Unmounting a holding shell releases its holdings cleanly — observers release
on their own unmount, `onError` does not re-fire, nothing leaks. A fresh mount
is a fresh world: a cached failure encountered again is claimed again.

### Ambient failures are aggregate, not per-operation

Twelve paused queries are not twelve offline states. The shell holds them
together:

```tsx
function OfflineBanner() {
  const { latest, affected } = AppShell.useHeld()
  if (!latest) return null
  return <Banner tag={latest._tag} count={affected} />
}
```

That is the structural reason the per-operation error channel was the wrong
home for connectivity: no single operation owns it.

### The server declares, the client discharges

Middleware adds an error to the union and produces context. A shell removes
the error and produces context. They are inverses over the same declaration:

```ts
// shared/errors.ts
export const authErrors = { Unauthorized, SessionExpired }

// server
const authenticated = app.middleware<{ user: User }>().errors(authErrors).use(/* ... */)

// client
const AuthShell = defineShell({ name: "auth", claims: authErrors, /* ... */ })
```

Add an error to `authErrors` and every derived shell absorbs it; no component
union changes and nothing breaks. Remove one and the components that branched
on it stop compiling. The shared map is a value in the shared contract
package, so no server middleware code reaches the browser bundle.

## Layers: one auth declaration instead of three

The footgun: every authenticated app maintains three artifacts that must agree
and drift apart anyway — the server middleware that resolves the session, the
`/me` endpoint the client bootstraps from, and the React context that hands
`user` to components. Three files, one concept, no compiler between them.

A **layer** (this word means exactly this artifact, nothing else in this
document) is the one shared declaration those three derive from: the context
key it fills, the wire codec of the value it guarantees, and the errors that
occur while establishing it.

```ts
// shared
import { defineLayer } from "result-rpc"

export const AuthLayer = defineLayer({
  name: "auth",
  key: "user",                       // the context property and the guarantee
  provides: UserCodec,               // wire codec for the guaranteed value
  errors: { Unauthorized, SessionExpired },
})
```

The server half derives from it:

```ts
// server
const authenticated = AuthLayer.middleware(app, async ({ context, errors }) => {
  const user = await context.auth.user()
  return user ? ok(user) : err(errors.Unauthorized({}))
})
// Middleware<AppContext, AppContext & { user: User }, typeof AuthLayer.errors>

export const whoami = AuthLayer.procedure(app, authenticated)
// the context procedure: {} -> User with the layer union. Its handler is
// derived — it returns the user the middleware placed in context — so the
// endpoint *cannot* disagree with the middleware. That is the drift, deleted.
```

(Contract-first codebases put `AuthLayer.contract(app)` in the shared contract
and pass it as `AuthLayer.procedure(app, contract, authenticated)`.)

And the React half is its sibling:

```tsx
// client
import { layerShell } from "result-rpc/react"

export const AuthShell = layerShell(AuthLayer, {
  from: DefectShell,
  procedure: client.auth.whoami,
  onError: () => redirect("/login"),
})
```

`AuthShell.Provider` loads the value through the context procedure — rendering
`fallback` until it resolves — provides it to the subtree, and claims the
layer union. The load itself runs under the enclosing shells, so an offline
blip during establishment pauses under the app shell like any other operation;
only the layer's own errors reach `onError`.

The middleware, the endpoint, and the shell all close over the same `provides`
codec and the same error map. There is nothing left to keep in sync.

### Optional layers refine into required ones

A session cookie may or may not resolve to a user, and public pages want
`viewer: User | null` while account pages want `User`. Declare the optional
layer with no errors — it always establishes — and derive the required layer
by refinement:

```ts
export const SessionLayer = defineLayer({
  name: "session",
  key: "viewer",
  provides: wire.union([UserCodec, wire.null] as const),
  errors: {},                            // optional: cannot fail
})

export const ViewerLayer = SessionLayer.require({
  name: "viewer",
  provides: UserCodec,                   // the narrowed value
  errors: { Unauthorized },              // the union the refinement contributes
  refine: ({ value, errors }) =>
    value === null ? err(errors.Unauthorized({})) : ok(value),
})
```

On the server, context grows and narrows monotonically through the chain:

```ts
const session = SessionLayer.middleware(app, ({ context }) =>
  ok(await userFromCookie(context)))     // User | null — never fails

const requireViewer = ViewerLayer.middleware(app)  // no resolver: derived

app.procedure()
  .use(session)                          // context.viewer: User | null
  .use(requireViewer)                    // context.viewer: User
  .query(({ context }) => ok(greet(context.viewer)))
```

On the client the same shape appears as nested providers — the optional shell
claims nothing and provides the nullable value; the required shell claims
`Unauthorized` and provides the narrowed one:

```tsx
const SessionShell = layerShell(SessionLayer, { from: DefectShell, procedure: client.session })
const ViewerShell = layerShell(ViewerLayer, {
  from: SessionShell,
  procedure: client.viewer,
  onError: () => redirect("/login"),
})

// public page, inside SessionShell
SessionShell.use()   // User | null

// account page, inside ViewerShell
ViewerShell.use()    // User
```

### Keeping it honest

Narrowing this cheap can quietly become swallowing. The absorbed set is a
value:

```ts
AuthShell.claimedTags
// ["auth/unauthorized", "auth/session-expired", "client/http-failure",
//  "client/protocol-violation", "client/decode-failure", "server/internal",
//  "client/offline", "client/network-failure", "client/timeout"]
```

Assert on it in a type test or a unit test so that adding an
application-namespace tag to a shell is a deliberate, reviewable act.

## Bring your own router

result-rpc deliberately ships no router integration: shells are providers and
hooks, so they compose with any router (TanStack Router, Next, Waku, React
Native navigation) without the library knowing routers exist. The natural
mapping — layout route = shell, route loader = `runtime.prefetch`,
`errorComponent` = escalate target — is roughly sixty lines of app-owned glue;
`examples/05-router-glue/router-glue.tsx` is a complete copy-paste integration
for TanStack Router, including auto-derived loaders that prefetch a layer's
context procedure before its route commits.

## Mutations return the same Result state

```tsx
import { useResultMutation } from "result-rpc/react"
import { client } from "./client"

function RenameDoc({ id }: { id: string }) {
  const rename = useResultMutation(client.doc.rename, {
    optimistic: ({ title }, cache) => {
      const rollback = cache.update(
        client.doc.byId,
        { id },
        doc => doc && { ...doc, title },
      )

      return { rollback }
    },
    onFailure: (_error, _input, context) => {
      context?.rollback()
    },
    onCancel: (_input, context) => {
      context?.rollback()
    },
    onSettled: (result, _input, _context, cache) => {
      if (result.ok) cache.invalidate(client.doc.byId, { id })
    },
  })

  async function submit(title: string) {
    const result = await rename.mutate({ id, title })

    if (!result.ok && result.error._tag === "doc/title-conflict") {
      focusTitleField()
    }
  }

  return <RenameForm pending={rename.state === "pending"} onSubmit={submit} />
}
```

`AuthShell.useMutation` is the narrowed form: claimed failures never reach
`onFailure` or the returned state, and the `mutate` promise rejects with the
control sentinel — cancellation semantics, as described under
[What a claimed error does](#what-a-claimed-error-does-to-the-operation).

Optimistic rollback runs before observers receive the final failure state.
Cancellation is explicit because cancelling a request cannot guarantee that a
server-side mutation did not happen: call `rename.cancel()`. Cancellation
resets lifecycle state and rejects the pending `mutate` promise with the
library control sentinel; it never appears as an operation `Err`.

## Subscriptions keep lifecycle separate from failure

Declare the stream in the shared contract and attach its generator only on the
server:

```ts
export const docEventsContract = app
  .procedure()
  .input(wire.object({ docId: wire.string }))
  .output(DocEvent)
  .errors({ Unauthorized, DocNotFound })
  .subscription()

export const docEvents = app
  .implement(docEventsContract)
  .use(authenticated)
  .stream(async function* ({ input, errors, context }) {
    const doc = await context.docs.find(input.docId)
    if (!doc) {
      yield err(errors.DocNotFound({ docId: input.docId }))
      return
    }

    for await (const event of context.docs.events(input.docId)) {
      yield ok(event)
    }
  })
```

The direct client is an async iterable of the same Result union. React
observes connection state independently from the latest event or terminal
failure:

```tsx
const events = useResultSubscription(client.doc.events, { docId })

events.connection // "connecting" | "open" | "reconnecting" | "paused" | "closed"
events.result     // Ok<DocEvent> | Err<GetDocEventsError> | undefined
```

`AuthShell.useSubscription` narrows the same way: a claimed terminal failure
leaves `connection` at `"paused"` with no `result`, and the owning shell
reacts. A retryable disconnect moves through `reconnecting` and does not
publish a temporary `Err`; if retry policy is exhausted, the final connection
error appears in `events.result`. Every frame is sequence-checked and
independently encoded by the same versioned serializer as unary and batched
responses.

Subscriptions currently run over the streaming HTTP transport; SSE resume
(`Last-Event-ID`) is deliberately deferred until a real deployment demands it.

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

## Rich values are transparently wire-safe

Error definitions describe the encoded value, not an optimistic in-memory
type:

```ts
export const SaveConflict = error({
  tag: "doc/save-conflict",
  data: wire.object({
    docId: wire.string,
    theirSavedAt: wire.date,      // a real Date on both sides of the wire
    revision: wire.bigint,        // a real BigInt, not a stringified one
  }),
  httpStatus: 409,
})
```

result-rpc uses a pinned, protocol-versioned devalue transport. Success values
and tagged error data transparently preserve:

- `undefined`, `NaN`, infinity, and `-0`
- `Date`, `BigInt`, `RegExp`, `URL`, and `URLSearchParams`
- `Map`, `Set`, `ArrayBuffer`, and typed arrays
- Temporal values when `Temporal` is available in both runtimes
- cycles and repeated object identity

```ts
const RichDoc = wire.object({
  savedAt: wire.date,
  revision: wire.bigint,
  pattern: wire.regexp,
  homepage: wire.url,
})
```

For a recursive or otherwise richer application type, validate serializer
support at the boundary:

```ts
const Graph = wire.serializable<DocGraph>()
```

Functions, symbols, unsupported class instances, and arbitrary `Error` causes
are rejected. Tagged error constructors perform a real serializer preflight,
so a custom wire codec cannot smuggle an unsupported runtime value into an
error.

Encoded request, response, hydration, and tagged-error byte limits are
enforced at runtime. Invalid values are never reflected back to the client.
Custom procedure codecs can enforce finer domain-specific collection, string,
and nesting limits.

## File uploads keep the typed input

`File` and `Blob` cannot cross a value serializer, and the usual answer —
degrade the whole input to `FormData` — costs the contract exactly where
uploads need it most. result-rpc keeps the typed object; files ride as
multipart sidecar parts the runtime substitutes transparently:

```ts
const setAvatar = app.procedure()
  .input(wire.object({
    userId: wire.string,
    image: wire.file({ maxBytes: 5_000_000, accept: ["image/*"] }),
  }))
  .output(AvatarCodec)
  .errors({ ImageUnprocessable })
  .mutation(async ({ input }) => {
    // input.image is a real File — name, size, stream(), the works
    return ok(await store(input.userId, input.image))
  })

await client.setAvatar({ userId, image: fileInput.files[0] })
```

Size and MIME constraints are declared on the codec and enforced on both sides
— oversized or wrong-typed files reject at the client before any bytes move,
and again on the server. Uploads bypass batching (one multipart request per
call), subscriptions reject file inputs, and a file marker smuggled into an
ordinary request never resolves — the substitution only exists on multipart
requests and must be a perfect bijection with the parts.

## Cancellation is not an operation error

Query cancellation updates lifecycle state without producing an `Err`,
consuming a retry, or entering an error boundary.

Direct calls accept an `AbortSignal`:

```ts
const controller = new AbortController()

const pending = client.doc.byId(
  { id: "doc_123" },
  { signal: controller.signal },
)

controller.abort()
```

Internally result-rpc uses one tagged `control/cancelled` sentinel so
cancellation does not depend on platform-specific `AbortError` identity. It is
control flow and is excluded from the recoverable error union. The same
sentinel is what a shell-claimed mutation rejects with — one concept, one
handler at the call site.

## Server-side calls keep wire parity

```ts
import { createServerClient } from "result-rpc/server"
import { appRouter } from "./router"

const serverClient = createServerClient(appRouter, {
  mode: "parity",
  context,
})

const result = await serverClient.doc.byId({ id: "doc_123" })
```

Parity mode executes locally but still applies input, output, and error
codecs. A value that would fail remotely also fails during SSR, tests, and
server components. Parity is the only mode for now; an unchecked fast path can
follow if profiling ever demands one.

## SSR and hydration

```tsx
// Server
const runtime = createQueryRuntime({ client: serverClient })

await runtime.prefetch(serverClient.doc.byId, { id })

const dehydrated = runtime.dehydrate()

// Browser
return <ResultRpcProvider client={client} hydrate={dehydrated}>{children}</ResultRpcProvider>
```

The cache format is versioned and each hydrated success is validated against
its procedure output codec before use. Invalid data removes only the affected
entry. Failed queries are not dehydrated by default. Cancellation and
transient connection state are never persisted.

## Test procedures without a network

```ts
import { createTestClient } from "result-rpc/testing"
import { appRouter } from "./router"

const client = createTestClient(appRouter, {
  context: testContext,
  mode: "parity",
})

const result = await client.doc.byId({ id: "missing" })

expect(result).toEqual({
  ok: false,
  error: {
    _tag: "doc/not-found",
    data: { docId: "missing" },
  },
})
```

Parity mode runs the same codecs and undeclared-error checks as the remote
protocol. A separate test transport covers malformed envelopes, 5xx responses,
timeouts, offline behavior, and batch failures.

## Observability

The footgun: a Sentry event that says `TRPCClientError: UNAUTHORIZED` with a
stack that points into library code, and a dashboard you reconstruct from
string codes after the fact. When observability is table stakes, "which
operation, which tag, who owned it, what did the server actually see" cannot
be archaeology.

Every observable moment is already a value at a known choke point, so
observability is one structured stream plus adapters — never an integration
that fights the framework. Four taps, one per tier:

```ts
// 1. Wire: every call, retry, claim — paths, tags, timing; never values.
const client = createClient({
  contract,
  transport,
  onEvent: (event) => Sentry.addBreadcrumb({
    category: `rpc.${event.type}`,
    message: event.path,
    level: event.type === "failure" ? "warning" : "info",
    data: event,
  }),
})
// event: call | success | failure | retry
//      | claimed  ← a shell took ownership: { path, tag, owner, effect }

// 2. Ownership: a shell's reaction is a reporting moment.
const AuthShell = layerShell(AuthLayer, {
  from: DefectShell,
  procedure: (client: AppClient) => client.auth.me,
  onError: (error) => {
    Sentry.captureMessage(`signed out: ${error._tag}`, "info")
    redirect("/login")
  },
})

// 3. Server, declared errors: policy included, so severity routes the sink.
createFetchHandler({
  router,
  onError: ({ error, policy, procedurePath, httpStatus }) => {
    metrics.increment(error._tag, { status: httpStatus })
    if (policy?.severity === "error") Sentry.captureMessage(error._tag)
  },
  // 4. Server, defects: the only place causes and stacks exist.
  onInternalError: ({ incidentId, cause, procedurePath, phase }) => {
    Sentry.captureException(cause, { tags: { incidentId, procedurePath, phase } })
  },
})
```

The wire stream is redaction-safe by construction: events carry paths, tags,
durations, owners — never inputs or outputs — so forwarding it verbatim to a
third-party tracker is not a data decision.

For inline observation of a single Result, the tap combinators return the
original value unchanged:

```ts
tapError(await client.doc.rename(input), (error) => log.warn(error._tag))
// also: tap(result, fn), tapBoth(result, { ok, error })
```

## What result-rpc owns

| Concern | result-rpc contract |
| --- | --- |
| Result composition | Plain Result values, union-preserving combinators, exhaustive matching |
| Error definitions | Namespaced tags, wire codecs, HTTP/retry/visibility policy |
| RPC | Procedures, middleware, routers, server execution, protocol, clients |
| Transport failures | Tagged additions to each procedure's inferred error union |
| Query runtime | Keys, caching, retries, invalidation, lifecycle, hydration |
| Failure ownership | Shells that subtract claimed tags and guarantee context |
| React | Query, mutation, subscription, suspense, and SSR bindings |
| Diagnostics | Safe incident IDs publicly; full causes only in local observability |
| Observability | Wire event stream, claim breadcrumbs, policy-aware server taps, Result taps |

The query engine uses `@tanstack/query-core` privately. That is an engine
choice, not part of the public API. Applications do not install or compose
better-result, tRPC, or React Query around result-rpc.

## Examples

The `examples/` directory is an escalation ladder, each rung a runnable app
with its own tests:

1. **01-hello** — one query, one error, no shells: the minimal surface.
2. **02-todo** — mutations, optimistic updates, the basic onion, an error
   catalog over a shell-narrowed union.
3. **03-docs** — the whole system: a service graph, optional→required layers,
   a five-shell onion, a feature shell, subscriptions, and a defect boundary.
   Its compile-time probes assert the payoff directly: under the full onion, a
   mutation declaring nine failure tags presents exactly one.
4. **04-router** — TanStack Router integration by hand: routes are shells.
   Pathless layouts mount the session and viewer layers, a route claims its
   feature error, `errorComponent` receives escalated defects, `onError`
   navigates, and layout loaders prefetch each layer's context procedure so
   the first paint has no fallback states.
5. **05-router-glue** — rung 4 rebuilt on app-owned glue
   (`router-glue.tsx`, ~60 lines): `routeShell` fragments spread into
   `createRoute`, so one declaration per layer produces both the provider
   component and the prefetch loader — proof the integration needs no package.
6. **06-sentry** — the observability pillar end to end: a Sentry-shaped stub
   receives wire breadcrumbs, the `claimed` trail with its owning shell,
   severity-routed server captures, and a defect whose captured exception
   carries the same incident id the client received — correlation with no
   request-id plumbing.

## Design and verification

The target architecture and underlying research live in:

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DESIGN.md](./DESIGN.md)

The repository includes runtime conformance tests, closed-union compile-time
tests, declaration builds, package-export smoke tests, and an npm manifest
audit. See the completed implementation sequence and remaining deliberate
non-goals in [ARCHITECTURE.md](./ARCHITECTURE.md#initial-implementation-sequence).

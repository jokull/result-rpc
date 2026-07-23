# result-rpc

One Result. One error union. Server to screen.

result-rpc is a wire-first TypeScript stack for Result composition, RPC, reactive
queries, mutations, and subscriptions. Every recoverable failure is a tagged,
wire-safe value—and every layer contributes to the same operation-specific union.

```ts
const query = useResultQuery(client.trip.byId, { id: "trip_123" })

if (query.state === "failure") {
  // TripNotFound | Unauthorized | ServerInternal | Offline |
  // NetworkFailure | Timeout | HttpFailure | ProtocolViolation | DecodeFailure
  query.result.error
}
```

No `Result` inside `data`. No transport error somewhere else. No `unknown` catch
branch. No error class pretending it will survive JSON.

That union is the truth about the operation, and it is always available. But a
component rendering a trip does not want to branch on nine things. So the same
union is narrowed by the layers it renders inside:

```ts
const query = AuthShell.useQuery(client.trip.byId, { id: "trip_123" })

if (query.state === "failure") {
  // TripNotFound
  query.result.error
}
```

Nothing was hidden. `Unauthorized` is gone because an enclosing layer guarantees a
session and redirects when that stops being true. The transport tags are gone
because the app shell owns the offline banner. The protocol tags are gone because
they escalate to an error boundary. Each layer subtracts exactly what it takes
responsibility for, and it does so in the type.

> [!IMPORTANT]
> This README is the target public API and corresponds to the current source. The
> package is not yet published; packaging metadata intentionally remains private
> while the API is reviewed.

## The problem

A conventional Result + RPC + query stack creates two failure tiers:

```ts
const query = useQuery({
  queryFn: () => rpc.trip.byId.query({ id }),
})

query.data
// Result<Trip, TripNotFound | Unauthorized> | undefined

query.error
// RPCError | NetworkError | null
```

Domain failures are successful query data. Network failures use the query error
channel. Retries, error boundaries, offline behavior, and exhaustive matching now
operate on different halves of the same operation.

result-rpc makes the operation the unit of composition:

```ts
type GetTripError =
  | TripNotFound
  | Unauthorized
  | ServerInternal
  | Offline
  | NetworkFailure
  | Timeout
  | HttpFailure
  | ProtocolViolation
  | DecodeFailure
```

The shared contract declares server and middleware errors. The client
boundary adds transport and protocol errors. The query runtime preserves the full
union while handling caching, retries, pausing, hydration, and cancellation.

### The second problem

A complete union is honest, but exhaustiveness is not the same as relevance. A
component that renders a trip has business with `TripNotFound`. It has no business
deciding what happens when the network is down, when the server sends a malformed
envelope, or when the session is revoked mid-render. Those are real failures, but
they are owned somewhere else — an app-wide banner, an error boundary, a redirect.

Forcing every call site to branch on them is the burden a two-tier stack was
avoiding in the first place. So result-rpc keeps the union complete at the
contract and lets the application declare, in one place per concern, which tags an
enclosing layer takes responsibility for. Those tags leave the component's union.
See [Shells](#shells-narrow-the-union-by-layer).

## Install

Target package:

```sh
npm install result-rpc
```

The library ships as one versioned package with focused exports:

```ts
import { error, errorCatalog, err, ok, wire, defineLayer, defineService } from "result-rpc"
import { rpc, type RouterInputs, type RouterOutputs } from "result-rpc/contract"
import { createFetchHandler, resolveServices } from "result-rpc/server"
import { batchFetchTransport, createClient } from "result-rpc/client"
import { defineShell, layerShell, ResultRpcProvider, useResultQuery } from "result-rpc/react"
```

`result-rpc/query` remains available when the runtime is needed directly (SSR
prefetch, framework-neutral integrations); React apps rarely import it.

## Define errors once

Errors are plain frozen values created from wire codecs. They are not subclasses of
`Error`.

```ts
import { error, wire } from "result-rpc"

export const TripNotFound = error({
  tag: "trip/not-found",
  data: wire.object({ tripId: wire.string }),
  httpStatus: 404,
})

export const Unauthorized = error({ tag: "auth/unauthorized", httpStatus: 401 })

export type TripNotFound = ReturnType<typeof TripNotFound>
export type Unauthorized = ReturnType<typeof Unauthorized>
```

Group the definitions that belong to one concern. The same map is what a
middleware declares on the server and what a shell claims on the client, so the
two halves cannot drift:

```ts
export const authErrors = { Unauthorized, SessionExpired }
```

`retry` defaults to `"never"`, `visibility` to `"public"`, and `data` to an
empty object codec — a domain error is a tag and an HTTP status until it needs
more. Data-free definitions are called with no arguments: `Unauthorized()`.

Calling a definition creates the complete error value:

```ts
const failure = TripNotFound({ tripId: "trip_123" })

// Readonly<{
//   _tag: "trip/not-found"
//   data: { tripId: string }
// }>
```

The tag is the identity. HTTP status and retry behavior are projections of that
identity for the relevant runtime.

There is no `.serialize()`. Values cross a boundary only through their definition's
actual encoder and decoder.

## Define the shared contract

```ts
import { wire, type InputOf } from "result-rpc"
import { rpc } from "result-rpc/contract"
import { TripNotFound, Unauthorized } from "./errors"

interface AppContext {
  trips: TripRepository
  auth: AuthService
}

export const app = rpc.context<AppContext>()

const TripCodec = wire.object({
  id: wire.string,
  title: wire.string,
  startsAt: wire.date,
})
type Trip = InputOf<typeof TripCodec>

export const getTripContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(TripCodec)
  .errors({ Unauthorized, TripNotFound })
  .query()

export const appContract = app.contract({
  trip: {
    byId: getTripContract,
  },
})
```

The shared contract is safe to import in a browser. It contains codecs, tags, and
policies, but no middleware or handler code.

## Implement the contract on the server

```ts
import { err, ok } from "result-rpc"
import { app, getTripContract } from "./contract"

export const getTrip = app
  .implement(getTripContract)
  .use(authenticated)
  .handler(async ({ input, errors, context }) => {
    const trip = await context.trips.find(input.id)

    if (!trip) return err(errors.TripNotFound({ tripId: input.id }))

    return ok(trip)
  })
```

The handler must return the declared Result:

```ts
Result<Trip, Unauthorized | TripNotFound>
```

Returning a different tag is a type error. Smuggling an undeclared or malformed
tag at runtime does not make it public: result-rpc logs the defect and emits a
sanitized `server/internal` value.

## Middleware participates in the same union

```ts
import { err } from "result-rpc"
import { app } from "./trip"
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

export const getTrip = app
  .implement(getTripContract)
  .use(authenticated)
  .handler(/* ... */)
```

The procedure now returns:

```ts
Result<Trip, Unauthorized | TripNotFound>
```

In contract-first code, middleware errors must already be present in the shared
contract; `app.implement(...).use(...)` rejects an undeclared contribution. The
code-first convenience form unions middleware definitions automatically. Duplicate
tags with different definitions are rejected rather than silently overridden.

## Two kinds of context

A procedure sees one `context`, but two different things feed it, with different
lifetimes and failure rules:

| | Services | Request layers |
| --- | --- | --- |
| Examples | database pool, worker bindings, API clients | session, viewer, organization |
| Lifetime | process | request |
| Shape | dependency graph | ordered chain |
| Can fail with a wire error | no — a broken service is a broken process | yes — failures join the operation union |
| Owned by | `defineService` / `resolveServices` | middleware and layers |

### Services

A service declares its dependencies; the graph is resolved once at process
start, memoized by definition reference identity — a service two others depend
on is constructed exactly once (store definitions in module constants; two
`defineService` calls are two services):

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

The resolved record becomes the root context that every request closes over:

```ts
export const handleRpc = createFetchHandler({
  router: appRouter,
  createContext: ({ request }) => ({ ...services, request }),
})
```

Nothing pulls services per call — the auth middleware reads `context.db` because
the root context guarantees it, and swapping the whole record for a test double
is one argument to `createContext`.

### Request layers compose by requirement, not by ordering

A middleware can declare what it runs after. The dependency's output becomes the
handler's input, the dependency's errors join the union, and any `.use()` site
pulls the whole chain in dependency order — deduplicated by reference, so a
diamond runs its shared dependency once:

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
export const renameTrip = app.procedure()
  .input(RenameInput)
  .output(TripCodec)
  .use(requireViewer)                    // session comes along, in order
  .mutation(({ context, input }) =>      // context.viewer: User
    context.db.trips.rename(input, context.viewer))
```

`.use(session)` followed by `.use(requireViewer)` still runs `session` once —
composition is by reference identity, exactly like service memoization. And a
middleware whose input demands context the procedure cannot supply is a type
error, so requirements are checked, not hoped for.

The layer factory uses the same mechanism: `ViewerLayer.middleware(app, session)`
bundles the parent, so `.use(requireViewer)` and
`ViewerLayer.implement(app, contract, requireViewer)` are each one call.

## Create the router and server

```ts
import { createFetchHandler } from "result-rpc/server"
import { app, getTrip } from "./trip"

export const appRouter = app.router({
  trip: {
    byId: getTrip,
  },
})

export type AppRouter = typeof appRouter

// Nested inference helpers mirror the router's shape — works on contracts too:
// type Inputs = RouterInputs<AppRouter>;  Inputs["trip"]["byId"]  → { id: string }
// type Outputs = RouterOutputs<AppRouter>; Outputs["trip"]["byId"] → Trip
// type Errors = RouterErrors<AppRouter>;   Errors["trip"]["byId"]  → declared union

export const handleRpc = createFetchHandler({
  router: appRouter,
  endpoint: "/rpc",
  createContext: ({ request }) => ({
    request,
    auth,
    trips,
  }),
  onInternalError: ({ incidentId, phase, cause, procedurePath }) => {
    logger.error({ incidentId, phase, cause, procedurePath })
  },
})
```

Unknown exceptions are logged with an incident ID. The client receives only:

```ts
{
  _tag: "server/internal",
  data: { incidentId: "inc_..." },
}
```

Exception messages, stacks, causes, queries, and response bodies are not reflected
over the wire.

## Call it directly

```ts
import { createClient, fetchTransport } from "result-rpc/client"
import { appContract } from "../shared/contract"

export const client = createClient({
  contract: appContract,
  transport: batchFetchTransport({ url: "/rpc" }),
})

const result = await client.trip.byId({ id: "trip_123" })
```

Calls issued in the same microtask share one HTTP request. Every batch item keeps
its own status, decoder, rich-value envelope, and tagged Result. Use
`fetchTransport` when batching is not wanted; the client API is unchanged.

The direct client is the honest base: it always resolves the complete union.
Narrowing is a property of where a call is rendered, and the direct client is not
rendered anywhere, so it never subtracts anything.

```ts
Result<
  Trip,
  | Unauthorized
  | TripNotFound
  | ServerInternal
  | Offline
  | NetworkFailure
  | Timeout
  | HttpFailure
  | ProtocolViolation
  | DecodeFailure
>
```

Handle the union with an ordinary switch:

```ts
if (result.ok) {
  console.log(result.value.title)
} else {
  switch (result.error._tag) {
    case "trip/not-found":
      console.log(`Missing ${result.error.data.tripId}`)
      break

    case "auth/unauthorized":
      redirectToLogin()
      break

    case "client/offline":
      showOfflineNotice()
      break

    case "client/network-failure":
    case "client/timeout":
      showTryAgain()
      break

    case "client/http-failure":
    case "client/protocol-violation":
    case "client/decode-failure":
    case "server/internal":
      showUnexpectedFailure()
      break

    default:
      result.error satisfies never
  }
}
```

For a reusable projection — a message catalog, a metrics mapper — build it once
from the same definition map middleware and shells use:

```ts
import { errorCatalog } from "result-rpc"

const message = errorCatalog({ TripNotFound, Unauthorized }, {
  "trip/not-found": (e) => `Trip ${e.data.tripId} is gone`,
  "auth/unauthorized": () => "Sign in to continue",
})
```

Adding a definition to the map breaks every catalog missing the new tag.

Or use exhaustive matching inline:

```ts
import { matchError } from "result-rpc"

if (!result.ok) {
  return matchError(result.error, {
    "trip/not-found": error => `Missing ${error.data.tripId}`,
    "auth/unauthorized": () => "Sign in required",
    "client/offline": () => "You're offline",
    "client/network-failure": () => "Could not reach the server",
    "client/timeout": () => "The request timed out",
    "client/http-failure": error => `HTTP ${error.data.status}`,
    "client/protocol-violation": () => "Invalid server response",
    "client/decode-failure": () => "Response did not match its contract",
    "server/internal": error => `Incident ${error.data.incidentId}`,
  })
}
```

Adding an error to the procedure or client boundary makes this match fail to
compile until the new case is handled.

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

export function TripPage({ id }: { id: string }) {
  const trip = useResultQuery(client.trip.byId, { id })

  switch (trip.state) {
    case "pending":
      return trip.fetch === "paused"
        ? <OfflinePlaceholder />
        : <TripSkeleton />

    case "success":
      return (
        <TripView
          trip={trip.result.value}
          refreshing={trip.fetch === "fetching"}
        />
      )

    case "failure":
      return (
        <TripFailure
          error={trip.result.error}
          previous={trip.previous}
          retry={trip.refetch}
        />
      )
  }
}
```

There is no top-level `data | error` pair:

```ts
trip.result
// Ok<Trip> | Err<GetTripError> | undefined
```

The query engine still caches successful values, retries transient failures,
tracks failure counts, pauses offline work, and supports invalidation. It uses its
failure channel internally and projects it back into the public Result state.

`useResultQuery` is the unnarrowed hook: it always yields the operation's complete
union. Applications normally reach for a shell's hooks instead, so that each layer
of the tree only presents the failures it is actually responsible for. See
[Shells](#shells-narrow-the-union-by-layer).

For Suspense, use `useResultSuspenseQuery`. It suspends only while pending and
returns the same success-or-failure state after settlement; tagged failures remain
ordinary Result values rather than becoming a second thrown error type.

### Failed background refreshes preserve stale data

A refetch can fail while a cached value remains useful. That is represented
explicitly:

```tsx
if (trip.state === "failure" && trip.previous) {
  return (
    <>
      <TripView trip={trip.previous} stale />
      <RefreshFailure error={trip.result.error} />
    </>
  )
}
```

`previous` is cached success from an earlier attempt. It is not another error
channel.

### Offline is lifecycle before it is failure

When an operation is waiting for connectivity:

```ts
trip.fetch === "paused"
```

This does not consume a retry or immediately become `client/offline`. An Offline
error appears only if the configured policy settles an attempted operation as a
failure.

## Shells narrow the union by layer

A shell is one layer of the application that takes responsibility for a class of
failure. It removes those tags from every operation rendered inside it, and it may
guarantee a value in exchange.

Which tier an error belongs to is already declared, on the error itself:

| Tier | Declared by | Owned by | Effect |
| --- | --- | --- | --- |
| Domain | your namespace, `retry: "never"` | the component | stays in the union |
| Ambient | `retry: "transient"` or `"after"` | the app shell | `pause` |
| Defect | framework namespace, `severity: "error"` | an error boundary | `escalate` |

`transportErrors` and `defectErrors` ship as ready-made maps for the second and
third rows.

### Declare the layers

```tsx
import { defectErrors, transportErrors } from "result-rpc"
import { defineShell } from "result-rpc/react"
import { authErrors } from "../shared/errors"

export const AppShell = defineShell({
  name: "app",
  handle: transportErrors,
  effect: "pause",
  onError: (error, { banner }) => banner.show(error),
  provide: (props: { banner: Banner }) => props,
})

export const DefectShell = defineShell({
  name: "defect",
  from: AppShell,
  handle: defectErrors,
  effect: "escalate",
})

export const AuthShell = defineShell({
  name: "auth",
  from: DefectShell,
  handle: authErrors,
  effect: "pause",
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
  <AppShell.Provider banner={banner}>
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
export function TripPage({ id }: { id: string }) {
  const { user } = AuthShell.use()      // User, not User | null
  const trip = AuthShell.useQuery(client.trip.byId, { id })

  switch (trip.state) {
    case "pending": return <TripSkeleton />
    case "success": return <TripView trip={trip.result.value} viewer={user} />
    case "failure":
      // TripNotFound — and adding a case for anything else is a type error
      return <TripMissing tripId={trip.result.error.data.tripId} />
  }
}
```

### Shells monitor everything beneath them

Absorption does not depend on which hook issued the operation. A component deep
in the tree calling plain `useResultQuery` still cannot surface
`auth/session-expired` as a failure under `AuthShell` — the mounted shell claims
it ambiently, pauses or escalates it, and counts it in `useActive()`. The wire
contract is the whole interface: shells own tags, not procedures.

What the shell *hooks* add is the type: `AuthShell.useQuery` subtracts the
claimed tags from the union and eagerly asserts the whole chain is mounted.
Plain hooks keep the full union — a sound over-approximation under a provider,
and exactly the truth outside one. Shells are error boundaries generalized to
values: selective by tag, non-destructive when pausing, and `escalate` converts
a claimed value back into a throw for the real boundary machinery.

### The layers are a value chain, not a tree position

`from:` makes the accumulated set a property of the shell value. `AuthShell` is
typed with its own claims plus everything `DefectShell` and `AppShell` claim, and
nobody writes that union by hand. Narrowing never depends on TypeScript inferring
where a component sits in the tree, because you cannot reach `AuthShell.useQuery`
without importing the shell that declares the handler.

Mount position is still checked, at runtime and eagerly: a `Provider` mounted
outside its `from:` layer throws, and a claimed error with no mounted claimant
throws rather than silently surfacing.

Two invariants are enforced at definition time:

- a tag may be claimed **once** per chain — overlapping layers are a `TypeError`;
- claims only accumulate inward, so an inner layer can never un-handle something
  an outer layer took responsibility for.

### What a claimed error does to the operation

A subtracted error never produces `state: "failure"` — that would be a lie about a
union it is no longer in.

```ts
effect: "pause"
```

- **Query** — the operation returns to a non-terminal state with `fetch: "paused"`.
  If a cached success exists it keeps rendering as `state: "success"`, stale, so an
  offline blip does not blank the screen. If not, `state: "pending"`.
- **Mutation** — state returns to `"idle"` and the pending `mutate` promise rejects
  with the library control sentinel, exactly like cancellation. The caller's
  continuation does not run on an outcome it no longer models.
- **Subscription** — `connection` becomes `"paused"` and `result` stays `undefined`.

```ts
effect: "escalate"
```

The tagged value is thrown to the nearest React error boundary. It is thrown as
the structural `TaggedError`, not wrapped in an `Error`, so the fallback can still
`matchError` on it.

`onError` fires once per newly claimed error per observer. One logical event —
a revoked session — arrives on every in-flight operation at once, so handlers must
be idempotent.

Pausing does not itself schedule a retry. The query runtime's ordinary policy
still owns that: a transient tag is retried before it is ever claimed, and the
paused operation resumes on reconnect or on explicit invalidation. A layer whose
effect is `pause` and whose handler navigates away is expected to unmount the
subtree it paused; a handler that does neither leaves the operation held.

### Ambient failures are aggregate, not per-operation

Twelve paused queries are not twelve offline states. The shell holds them
together:

```tsx
function OfflineBanner() {
  const { active, affected } = AppShell.useActive()
  if (!active) return null
  return <Banner tag={active._tag} count={affected} />
}
```

That is the structural reason the per-operation error channel was the wrong home
for connectivity: no single operation owns it.

### The server declares, the client discharges

Middleware adds an error to the union and produces context. A shell removes the
error and produces context. They are inverses over the same declaration:

```ts
// shared/errors.ts
export const authErrors = { Unauthorized, SessionExpired }

// server
const authenticated = app.middleware<{ user: User }>().errors(authErrors).use(/* ... */)

// client
const AuthShell = defineShell({ name: "auth", handle: authErrors, /* ... */ })
```

Add an error to `authErrors` and every derived shell absorbs it; no component
union changes and nothing breaks. Remove one and the components that branched on
it stop compiling. The shared map is a value in the shared contract package, so
no server middleware code reaches the browser bundle.

### Re-widening

A component that genuinely wants to own a claimed tag uses the unnarrowed hook:

```tsx
const trip = useResultQuery(client.trip.byId, { id })
// TripNotFound | Unauthorized | ServerInternal | ClientBoundaryError
```

There is no opt-out flag, because there is nothing to opt out of — you either hold
a narrowed shell hook or you do not. The enclosing shells still exist; they simply
have no claim on an operation that did not go through them.

### Derive the whole layer from one declaration

Auth is not just a shell: it is a middleware that adds `user` to server context,
a context procedure that tells the client who the user is, and a client layer
that guarantees the value. Those three artifacts share one value type and one
error union, so they should come from one declaration:

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

export const whoamiContract = AuthLayer.contract(app)
// query: {} -> User, errors = the layer union — safe in the shared contract

export const whoami = AuthLayer.implement(app, whoamiContract, authenticated)
// handler is derived: it returns context.user, so the procedure cannot
// disagree with the middleware about the value or the union
```

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
`fallback` until it resolves — provides it to the subtree, and claims the layer
union. The load itself runs under the enclosing shells, so an offline blip during
establishment pauses under the app shell like any other operation; only the
layer's own errors reach `onError`.

There is no way for the server's idea of "authenticated" and the client's to
drift: the middleware, the procedure, and the shell all close over the same
`provides` codec and the same error map.

### Optional layers refine into required ones

Not every layer is all-or-nothing. A session cookie may or may not resolve to a
user, and public pages want `viewer: User | null` while account pages want
`User`. Declare the optional layer with no errors — it always establishes — and
derive the required layer by refinement:

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

Narrowing this cheap can quietly become swallowing. The absorbed set is a value:

```ts
AuthShell.handledTags
// ["auth/unauthorized", "auth/session-expired", "client/http-failure",
//  "client/protocol-violation", "client/decode-failure", "server/internal",
//  "client/offline", "client/network-failure", "client/timeout"]
```

Assert on it in a type test or a unit test so that adding an application-namespace
tag to a shell is a deliberate, reviewable act.

## The router surface

`result-rpc/router` fuses shells with TanStack Router (an optional peer
dependency — the routing engine, params, search params, and preloading stay
native). A shell emits a route fragment: its Provider as the route `component`,
and — for layer shells — a `loader` that prefetches the layer's context
procedure before the route commits:

```tsx
import { createResultRouter, ResultRouterProvider, routeShell } from "result-rpc/router"

const authedRoute = createRoute({
  getParentRoute: () => sessionRoute,
  id: "authed",
  ...routeShell(ViewerShell, { pending: <p>signing in…</p> }),
})

const world = createResultRouter({
  client,
  router: (context) => createRouter({ routeTree, context }),
})

<ResultRouterProvider world={world} />
```

Every route below `authedRoute` renders with `viewer: User` guaranteed, the
auth union subtracted, and the viewer already fetched by the time the route
commits. `routeShell` also takes `layout:` (wrap the outlet in banners or
notices owned by the layer) and `component:` (leaf routes that own their page).

## Mutations return the same Result state

```tsx
import { useResultMutation } from "result-rpc/react"
import { client } from "./client"

function RenameTrip({ id }: { id: string }) {
  const rename = useResultMutation(client.trip.rename, {
    optimistic: ({ title }, cache) => {
      const rollback = cache.update(
        client.trip.byId,
        { id },
        trip => trip && { ...trip, title },
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
      if (result.ok) cache.invalidate(client.trip.byId, { id })
    },
  })

  async function submit(title: string) {
    const result = await rename.mutate({ id, title })

    if (!result.ok && result.error._tag === "trip/title-conflict") {
      focusTitleField()
    }
  }

  return <RenameForm pending={rename.state === "pending"} onSubmit={submit} />
}
```

`AuthShell.useMutation` is the narrowed form: claimed failures never reach
`onFailure` or the returned state, and the `mutate` promise rejects with the
control sentinel instead of resolving to an error the caller no longer models.

Optimistic rollback runs before observers receive the final failure state.
Cancellation is explicit because cancelling a request cannot guarantee that a
server-side mutation did not happen: call `rename.cancel()`. Cancellation resets
lifecycle state and rejects the pending `mutate` promise with the library control
sentinel; it never appears as an operation `Err`.

## Subscriptions keep lifecycle separate from failure

Declare the stream in the shared contract and attach its generator only on the
server:

```ts
export const tripEventsContract = app
  .procedure()
  .input(wire.object({ tripId: wire.string }))
  .output(TripEvent)
  .errors({ Unauthorized, TripNotFound })
  .subscription()

export const tripEvents = app
  .implement(tripEventsContract)
  .use(authenticated)
  .stream(async function* ({ input, errors, context }) {
    const trip = await context.trips.find(input.tripId)
    if (!trip) {
      yield err(errors.TripNotFound({ tripId: input.tripId }))
      return
    }

    for await (const event of context.trips.events(input.tripId)) {
      yield ok(event)
    }
  })
```

The direct client is an async iterable of the same Result union:

```ts
for await (const event of client.trip.events({ tripId })) {
  if (!event.ok) break
  renderEvent(event.value)
}
```

React observes connection state independently from the latest event or terminal
failure:

```tsx
const events = useResultSubscription(client.trip.events, { tripId })

events.connection // "connecting" | "open" | "reconnecting" | "paused" | "closed"
events.result     // Ok<TripEvent> | Err<GetTripEventsError> | undefined
```

`AuthShell.useSubscription` narrows the same way: a claimed terminal failure
leaves `connection` at `"paused"` with no `result`, and the owning layer reacts.

A retryable disconnect moves through `reconnecting` and does not publish a
temporary `Err`. If retry policy is exhausted, the final connection error appears
in `events.result`. Every frame is sequence-checked and independently encoded by
the same versioned devalue serializer as unary and batched responses.

## Retry policy follows the tag

Retry behavior is declared with the error rather than reconstructed from a message
or overlapping status code:

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

The query runtime owns query retry. A transport retry loop does not silently run
underneath it. Direct calls can opt into the same policy:

```ts
const result = await client.search.run(input, {
  retry: "from-error-policy",
})
```

## Rich values are transparently wire-safe

Error definitions describe the encoded value, not an optimistic in-memory type:

```ts
export const BookingConflict = error({
  tag: "booking/conflict",
  data: wire.object({
    bookingId: wire.string,
    conflictingDate: wire.date,
    sequence: wire.bigint,
  }),
  httpStatus: 409,
  retry: "never",
  visibility: "public",
})
```

result-rpc uses a pinned, protocol-versioned devalue transport. Success values and
tagged error data transparently preserve:

- `undefined`, `NaN`, infinity, and `-0`
- `Date`, `BigInt`, `RegExp`, `URL`, and `URLSearchParams`
- `Map`, `Set`, `ArrayBuffer`, and typed arrays
- Temporal values when `Temporal` is available in both runtimes
- cycles and repeated object identity

```ts
const RichTrip = wire.object({
  startsAt: wire.date,
  revision: wire.bigint,
  pattern: wire.regexp,
  homepage: wire.url,
})
```

For a recursive or otherwise richer application type, validate serializer support
at the boundary:

```ts
const Graph = wire.serializable<TripGraph>()
```

Functions, symbols, unsupported class instances, and arbitrary `Error` causes are
rejected. Tagged error constructors perform a real serializer preflight, so a
custom wire codec cannot smuggle an unsupported runtime value into an error.

Encoded request, response, hydration, and tagged-error byte limits are enforced at
runtime. Invalid values are never reflected back to the client. Custom procedure
codecs can enforce finer domain-specific collection, string, and nesting limits.


## Cancellation is not an operation error

Query cancellation updates lifecycle state without producing an `Err`, consuming a
retry, or entering an error boundary.

Direct calls accept an `AbortSignal`:

```ts
const controller = new AbortController()

const pending = client.trip.byId(
  { id: "trip_123" },
  { signal: controller.signal },
)

controller.abort()
```

Internally result-rpc uses one tagged `control/cancelled` sentinel so cancellation
does not depend on platform-specific `AbortError` identity. It is control flow and
is excluded from the recoverable error union.

## Server-side calls keep wire parity

```ts
import { createServerClient } from "result-rpc/server"
import { appRouter } from "./router"

const serverClient = createServerClient(appRouter, {
  mode: "parity",
  context,
})

const result = await serverClient.trip.byId({ id: "trip_123" })
```

Parity mode executes locally but still applies input, output, and error codecs. A
value that would fail remotely also fails during SSR, tests, and server components.

There is intentionally no unchecked mode in the initial release: SSR, tests, and
server components cannot accidentally observe a value that would fail remotely.

## SSR and hydration

```tsx
// Server
const runtime = createQueryRuntime({ client: serverClient })

await runtime.prefetch(serverClient.trip.byId, { id })

const dehydrated = runtime.dehydrate()

return <ResultRpcHydration state={dehydrated}>{children}</ResultRpcHydration>
```

The cache format is versioned and each hydrated success is validated against its
procedure output codec before use. Invalid data removes only the affected entry.

Failed queries are not dehydrated by default. Cancellation and transient connection
state are never persisted.

## Test procedures without a network

```ts
import { createTestClient } from "result-rpc/testing"
import { appRouter } from "./router"

const client = createTestClient(appRouter, {
  context: testContext,
  mode: "parity",
})

const result = await client.trip.byId({ id: "missing" })

expect(result).toEqual({
  ok: false,
  error: {
    _tag: "trip/not-found",
    data: { tripId: "missing" },
  },
})
```

Parity mode runs the same codecs and undeclared-error checks as the remote
protocol. A separate test transport covers malformed envelopes, 5xx responses,
timeouts, offline behavior, and batch failures.

## What result-rpc owns

| Concern | result-rpc contract |
| --- | --- |
| Result composition | Plain Result values, union-preserving combinators, exhaustive matching |
| Error definitions | Namespaced tags, wire codecs, HTTP/retry/visibility policy |
| RPC | Procedures, middleware, routers, server execution, protocol, clients |
| Transport failures | Tagged additions to each procedure's inferred error union |
| Query runtime | Keys, caching, retries, invalidation, lifecycle, hydration |
| Failure ownership | Layered shells that subtract claimed tags and guarantee context |
| React | Query, mutation, subscription, suspense, and SSR bindings |
| Diagnostics | Safe incident IDs publicly; full causes only in local observability |

An initial implementation may use `@tanstack/query-core` privately. That is an
engine choice, not part of the public API. Applications do not install or compose
better-result, tRPC, or React Query around result-rpc.

## Examples

The `examples/` directory is an escalation ladder, each rung a runnable app
with its own tests:

1. **01-hello** — one query, one error, no shells: the minimal surface.
2. **02-todo** — mutations, optimistic updates, the basic onion, an error
   catalog over a shell-narrowed union.
3. **03-trips** — the whole system: a service graph, optional→required layers,
   a five-layer shell onion, a feature shell, subscriptions, and a defect
   boundary. Its compile-time probes assert the payoff directly: under the full
   onion, a mutation declaring nine failure tags presents exactly one.
4. **04-router** — TanStack Router integration by hand: routes are shells.
   Pathless layouts mount the session and viewer layers, a route claims its
   feature error, `errorComponent` receives escalated defects, `onError`
   navigates, and layout loaders prefetch each layer's context procedure so the
   first paint has no fallback states.
5. **05-framework** — rung 4 rebuilt on `result-rpc/router`: `routeShell`
   fragments spread into `createRoute`, so one declaration per layer produces
   both the provider component and the prefetch loader. The diff between rungs
   4 and 5 is the framework's value proposition.

## Design and verification

The target architecture and underlying research live in:

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DESIGN.md](./DESIGN.md)

The repository includes runtime conformance tests, closed-union compile-time tests,
declaration builds, package-export smoke tests, and an npm manifest audit. See the
completed implementation sequence and remaining deliberate non-goals in
[ARCHITECTURE.md](./ARCHITECTURE.md#initial-implementation-sequence).

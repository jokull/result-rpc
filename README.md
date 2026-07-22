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

## Install

Target package:

```sh
npm install result-rpc
```

The library ships as one versioned package with focused exports:

```ts
import { error, err, ok, wire } from "result-rpc"
import { rpc } from "result-rpc/contract"
import { createFetchHandler } from "result-rpc/server"
import { batchFetchTransport, createClient } from "result-rpc/client"
import { createQueryRuntime } from "result-rpc/query"
import { ResultRpcProvider, useResultQuery } from "result-rpc/react"
```

## Define errors once

Errors are plain frozen values created from wire codecs. They are not subclasses of
`Error`.

```ts
import { error, wire } from "result-rpc"

export const TripNotFound = error({
  tag: "trip/not-found",
  data: wire.object({
    tripId: wire.string,
  }),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
})

export const Unauthorized = error({
  tag: "auth/unauthorized",
  data: wire.object({}),
  httpStatus: 401,
  retry: "never",
  visibility: "public",
})

export type TripNotFound = ReturnType<typeof TripNotFound>
export type Unauthorized = ReturnType<typeof Unauthorized>
```

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

The direct client resolves recoverable failures:

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

Or use exhaustive matching:

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

Create one client and query runtime:

```tsx
import { createQueryRuntime } from "result-rpc/query"
import { ResultRpcProvider } from "result-rpc/react"
import { client } from "./client"

const runtime = createQueryRuntime({ client })

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ResultRpcProvider runtime={runtime}>
      {children}
    </ResultRpcProvider>
  )
}
```

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
  data: wire.object({}),
  httpStatus: 503,
  retry: "transient",
  visibility: "public",
})

export const RateLimited = error({
  tag: "search/rate-limited",
  data: wire.object({
    retryAfterMs: wire.integer({ min: 0, max: 60_000 }),
  }),
  httpStatus: 429,
  retry: "after",
  visibility: "public",
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
| React | Query, mutation, subscription, suspense, and SSR bindings |
| Diagnostics | Safe incident IDs publicly; full causes only in local observability |

An initial implementation may use `@tanstack/query-core` privately. That is an
engine choice, not part of the public API. Applications do not install or compose
better-result, tRPC, or React Query around result-rpc.

## Design and verification

The target architecture and underlying research live in:

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DESIGN.md](./DESIGN.md)

The repository includes runtime conformance tests, closed-union compile-time tests,
declaration builds, package-export smoke tests, and an npm manifest audit. See the
completed implementation sequence and remaining deliberate non-goals in
[ARCHITECTURE.md](./ARCHITECTURE.md#initial-implementation-sequence).

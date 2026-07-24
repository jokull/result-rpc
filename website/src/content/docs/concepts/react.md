---
title: "React hooks"
description: "Result-native queries: exhaustive states, stale data on failed refreshes, offline as lifecycle, SSR hydration."
---

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

## Failed background refreshes preserve stale data

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

## Offline is lifecycle before it is failure

When an operation is waiting for connectivity:

```ts
doc.fetch === "paused"
```

This does not consume a retry or immediately become `client/offline`. An
Offline error appears only if the configured policy settles an attempted
operation as a failure.

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

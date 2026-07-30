---
title: "React hooks"
description: "Result-native queries: exhaustive states, stale data on failed refreshes, offline as lifecycle, SSR hydration."
---

Hand the provider your client; it owns a query runtime for its lifetime:

```tsx
import { ResultRpcProvider } from "result-rpc/react";
import { client } from "./client";

export function Providers({ children }: { children: React.ReactNode }) {
  return <ResultRpcProvider client={client}>{children}</ResultRpcProvider>;
}
```

Pass an explicit `runtime` instead when the app needs the instance elsewhere —
SSR prefetching, imperative cache access.

## Register the application client once

The default React entry follows TanStack's `Register` pattern. Augment it once
and `useResultClient()` returns the application client with no call-site
generic; deferred layer-shell selectors receive the same type:

```ts
import type { client } from "../../client";

declare module "result-rpc/react" {
  interface Register {
    client: typeof client;
  }
}
```

```tsx
import { useResultClient } from "result-rpc/react";

function SaveButton() {
  const client = useResultClient();
  // client.doc.save is known here
}
```

Declaration merging is application-wide. A monorepo that compiles several
independent applications in one TypeScript program should bind a local React
surface instead of registering several clients globally:

```ts
import { createResultRpcReact } from "result-rpc/react";
import type { client } from "../../client";

export const appReact = createResultRpcReact<typeof client>();

export const {
  ResultRpcProvider: AppResultRpcProvider,
  useResultClient: useAppResultClient,
  layerShell: appLayerShell,
} = appReact;
```

Use those three scoped exports consistently inside that application. They
share one client type without global declaration merging. The scoped hook and
layer shells require that binding's matching provider; mixing bindings fails
at the mount site instead of returning a falsely typed client.

Query a procedure:

```tsx
import { useResultQuery } from "result-rpc/react";
import { client } from "./client";

export function DocPage({ id }: { id: string }) {
  const doc = useResultQuery(client.doc.byId, { id });

  switch (doc.state) {
    case "pending":
      return doc.fetch === "paused" ? <OfflinePlaceholder /> : <DocSkeleton />;

    case "success":
      return <DocView doc={doc.value} refreshing={doc.fetch === "fetching"} />;

    case "failure":
      return <DocFailure error={doc.error} previous={doc.previous} retry={doc.refetch} />;
  }
}
```

The hook-level `refetch()` starts a new attempt and returns `Promise<void>`.
Awaiting it tells you the attempt settled; the resulting `QueryState` arrives
through the next React render. It does not return a snapshot or another
`Result`. For imperative code, the lower-level runtime observer's `refetch()`
returns the resulting state directly.

`value` and `error` are not an independently-nullable pair — each exists only
under its own state, so the impossible combinations are unrepresentable:

```ts
doc.value; // Doc      — only when doc.state === "success"
doc.error; // GetDocError — only when doc.state === "failure"
```

When Result-typed code needs the settled outcome as the same `Result` the
direct client returns, `toResult(doc)` re-wraps it (`undefined` while
pending).

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

When a shell can claim one of those failures, use `ResultSuspense` instead of a
plain React `Suspense` boundary:

```tsx
<ResultSuspense fallback={<DocumentSkeleton />}>
  <Document />
</ResultSuspense>
```

The committed boundary owns the shell lease because a child that suspends on
its first render cannot install effect cleanup. Give independently removable
branches their own boundaries. If a retained boundary switches to a different
conditional subtree, pass that identity as `resetKey` so the old branch's
claims are released.

## Failed background refreshes preserve stale data

A refetch can fail while a cached value remains useful. That is represented
explicitly:

```tsx
if (doc.state === "failure" && doc.previous) {
  return (
    <>
      <DocView doc={doc.previous} stale />
      <RefreshFailure error={doc.error} />
    </>
  );
}
```

`previous` is cached success from an earlier attempt. It is not another error
channel.

## Offline is lifecycle before it is failure

When an operation is waiting for connectivity:

```ts
doc.fetch === "paused";
```

This does not consume a retry or immediately become `client/offline`. An
Offline error appears only if the configured policy settles an attempted
operation as a failure.

## SSR and hydration

```tsx
// Server
import { createQueryRuntime } from "result-rpc/query";

const runtime = createQueryRuntime({ client: serverClient });

await runtime.prefetch(serverClient.doc.byId, { id });

const dehydrated = runtime.dehydrate();

// Browser
return (
  <ResultRpcProvider client={client} hydrate={dehydrated}>
    {children}
  </ResultRpcProvider>
);
```

The cache format is versioned and each hydrated success is validated against
its procedure output codec before use. Invalid data removes only the affected
entry. Failed queries are not dehydrated by default. Cancellation and
transient connection state are never persisted.

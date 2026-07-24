---
title: "Migrating from tRPC"
description: "Per-router coexistence, a mechanical concept mapping, and the auth-layer-first first slice."
---

Migration is per-router, not big-bang. result-rpc is a separate endpoint with
a separate client — it shares nothing with tRPC at runtime, so both stacks run
side by side for as long as the migration takes:

```ts
// server: two handlers, two routes
app.all("/api/trpc/*", trpcHandler)     // existing routers stay
app.post("/rpc", resultRpcHandler)      // migrated routers move here

// client: two clients during the transition
export const trpc = createTRPCReact<LegacyRouter>()
export const client = createClient({ contract, transport: batchFetchTransport({ url: "/rpc" }) })
```

The recommended first slice is **the auth layer plus one feature router** —
small enough to finish in days, and it exercises the part tRPC cannot express
(a shell owning session expiry) so the migration proves its value immediately
instead of at the end.

The concept mapping is mechanical:

| tRPC | result-rpc |
| --- | --- |
| `initTRPC.context<Ctx>().create()` | `rpc.context<Ctx>()` |
| `t.procedure.input(z...).query(fn)` | `app.procedure().input(wire...).output(wire...).errors({...}).query(fn)` |
| `throw new TRPCError({ code })` | `return err(errors.SomeError({...}))` |
| `t.middleware` + `ctx` spread | `app.middleware<Added>().errors({...}).use(...)` |
| `protectedProcedure` | `app.procedure().use(authenticated)` — same pattern |
| `httpBatchLink` | `batchFetchTransport` |
| `@trpc/react-query` hooks | `useResultQuery` / shell hooks |
| `errorFormatter` | gone — error data is a wire codec, not a formatted shape |
| adapter `onError` | `onError` + `onInternalError` on `createFetchHandler` |
| `createCaller` | `createServerClient` (parity mode) |
| `queryClient.setDefaultOptions({ onError })` | a shell |

Two things have no tRPC equivalent and are the actual work: every procedure
declares its error union (this is where the two-failure-channel debt gets paid
down, one procedure at a time), and interceptor logic moves into shells. There
is no codemod; each procedure is a five-minute mechanical rewrite.

During coexistence the two stacks keep **separate caches** — a result-rpc
mutation does not invalidate tRPC queries or vice versa. Migrate whole
features, not halves of one screen, and the seam stays invisible.

---
title: "Migrating from tRPC"
description: "Per-router coexistence, a mechanical concept mapping, and the auth-layer-first first slice."
---

Migration is per-router, not big-bang. result-rpc is a separate endpoint with
a separate client — it shares nothing with tRPC at runtime, so both stacks run
side by side for as long as the migration takes:

```ts
// server: two handlers, two routes
app.all("/api/trpc/*", trpcHandler); // existing routers stay
app.post("/rpc", resultRpcHandler); // migrated routers move here

// client: two clients during the transition
export const trpc = createTRPCReact<LegacyRouter>();
export const client = createBrowserClient({
  contract,
  transport: batchFetchTransport({ url: "/rpc" }),
});
```

One difference to internalize before your first slice: tRPC ships its router to
the client **as a type** (`createTRPCReact<LegacyRouter>`), erased at build.
result-rpc ships a **real client value** built from your `contract` — so _what
you import decides what bundles_. Pass the contract, never the server router, or
handlers and secrets ship to the browser. This is the one migration mistake that
is a security bug; read [The client boundary](/concepts/client-boundary/) first.

The recommended first slice is **the auth layer plus one feature router** —
small enough to finish in days, and it exercises the part tRPC cannot express
(a shell owning session expiry) so the migration proves its value immediately
instead of at the end.

The concept mapping is mechanical:

| tRPC                                         | result-rpc                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `initTRPC.context<Ctx>().create()`           | `serverRpc.context<Ctx>()`                                                  |
| `t.procedure.input(z...).query(fn)`          | `server.procedure().input(wire...).output(wire...).errors({...}).query(fn)` |
| `throw new TRPCError({ code })`              | `return err(errors.SomeError({...}))`                                       |
| `t.middleware` + `ctx` spread                | `server.middleware<Added>().errors({...}).use(...)`                         |
| `protectedProcedure`                         | `server.procedure().use(authenticated)` — same pattern                      |
| `httpBatchLink`                              | `batchFetchTransport`                                                       |
| `@trpc/react-query` hooks                    | `useResultQuery` / shell hooks                                              |
| `errorFormatter`                             | gone — error data is a wire codec, not a formatted shape                    |
| adapter `onError`                            | `onError` + `onInternalError` on `createFetchHandler`                       |
| `createCaller`                               | `createServerClient`                                                        |
| `ctx.resHeaders` / `responseMeta`            | `.headers()` on the procedure, then `context.headers`                       |
| `queryClient.setDefaultOptions({ onError })` | a shell                                                                     |

One row deserves a note, because it is a scar many tRPC codebases carry.
`ctx.resHeaders` works under `httpBatchLink` and silently stops working under
`httpBatchStreamLink` — a streamed response sends its headers before the
procedures resolve, so a cookie set inside a mutation is dropped with no error.
The usual workaround is to move it into `responseMeta`, which runs before the
result exists. Here the capability is declared with `.headers()`, batches do not
stream, and an undeclared procedure has no `context.headers` to write to — so
the failure mode is a type error rather than a missing cookie. See [Setting
response headers](/concepts/context/#setting-response-headers-and-logging-someone-in).

Two things have no tRPC equivalent and are the actual work: every procedure
declares its error union (this is where the two-failure-channel debt gets paid
down, one procedure at a time), and interceptor logic moves into shells. There
is no codemod; each procedure is a five-minute mechanical rewrite.

During coexistence the two stacks keep **separate caches** — a result-rpc
mutation does not invalidate tRPC queries or vice versa. Migrate whole
features, not halves of one screen, and the seam stays invisible.

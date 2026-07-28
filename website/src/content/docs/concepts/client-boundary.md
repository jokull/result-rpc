---
title: "The client boundary"
description: "result-rpc ships a real client to the browser, not just a type — so what you import decides what bundles. Import the contract, never the router."
---

Read this page before you wire a client. It is the one place where a wrong
import is a **security bug**, not a style choice.

## result-rpc is not tRPC here

tRPC ships **a type** to the client. `AppRouter` is imported `import type`, erased
at build, and the browser gets nothing but inference. You can point tRPC's client
at your server router because only its shape survives.

result-rpc ships **a value** to the client — a real runtime built from your
contract, with codecs that encode inputs and decode outputs. That value has to
exist in the browser. So the question "what ends up in my bundle?" has a real
answer, and you are responsible for it.

The rule is one sentence:

> **Build the browser client from a `contract()`, and define that contract in a
> module that never imports handler or server code.**

Do that and your bundle contains codecs and error definitions — nothing else.
Get it wrong and your handlers, middleware, database driver, and any secret they
close over ship to every visitor.

## What a contract carries, and what a router carries

Two different values, two different payloads:

- **`contract()`** — procedure *shapes* only: input codec, output codec, declared
  error definitions, `.affects()`/`.writes()` invalidation maps. No handlers, no
  middleware. This is the browser-safe surface, and the client only ever reads
  these fields.
- **`router()`** (and any implemented procedure) — *everything the contract has,
  plus the handler function and its middleware chain*, which close over your
  database, your services, your environment. Server-only.

The client engine never calls a handler — it reads `input`, `output`,
`definitions`, and `kind`. But a value it can reach, a bundler must keep. Hand it
a router and the handler closures are live properties of live objects; they
cannot be tree-shaken away.

## The footgun, demonstrated

A handler that closes over a secret:

```ts
// server.ts
const getUser = app.implement(getUserContract).handler(async ({ input }) => {
  const key = process.env.STRIPE_SECRET_KEY!   // closed over by the handler
  const row = await db.query.users.findFirst(...)
  return ok(row)
})
export const appRouter = app.router({ users: { get: getUser } })
```

Two client entries, bundled and grepped:

```ts
// ✅ client-good.ts — imports the standalone contract
import { appContract } from "./contract"
createClient({ contract: appContract, transport })
// bundle: STRIPE_SECRET_KEY → 0 hits. db driver → 0 hits.

// ☠️ client-bad.ts — imports the router
import { appRouter } from "./server"
createClient({ router: appRouter, transport })
// bundle: STRIPE_SECRET_KEY → SHIPPED. db driver → SHIPPED.
```

**Your bundler will not warn you.** `"sideEffects": false` does not help here: a
top-level `app.router(...)` or `.handler(...)` call is a function call the
bundler treats as potentially side-effecting, so it keeps the whole graph. The
secret is in the browser and nothing failed.

In development, result-rpc itself will `console.warn` if you hand a `router` to
`createClient` in a browser — but treat that as a last-resort net, not the
design. The design is: never import the router into client code.

## The safe layout

The dependency arrow points **from server to contract**, never the reverse:

```
contract.ts   ── imports: result-rpc, wire codecs, models, error defs
   ▲                (and `import type` from server is fine — types are erased)
   │
server.ts     ── imports contract.ts, implements handlers, builds the router
client.ts     ── imports contract.ts, builds the browser client
```

```ts
// contract.ts — no server imports; safe to reach from anywhere
import { rpc, wire } from "result-rpc"
import type { AppContext } from "./server"     // type-only: erased at build
export const getUserContract = rpc.context<AppContext>()
  .procedure().input(...).output(...).query()
export const appContract = rpc.context<AppContext>().contract({
  users: { get: getUserContract },
})
```

```ts
// server.ts — imports the contract to implement it
import { appContract, getUserContract } from "./contract"
const getUser = rpc.context<AppContext>().implement(getUserContract).handler(...)
export const appRouter = rpc.context<AppContext>().router({ users: { get: getUser } })
```

```ts
// client.ts — imports the contract only
import { appContract } from "./contract"
export const client = createClient({ contract: appContract, transport })
```

Three cheap rules keep this honest:

1. **Contracts import no runtime server code.** `import type` is fine; a value
   import from a server module is the footgun.
2. **`.affects()` targets are contract references**, never implemented
   procedures — an implemented procedure passed as a target drags its handler
   into the contract graph.
3. **Never import the router into anything a browser bundles.** Colocating "for
   convenience" ships handlers; there is no convenience worth a leaked secret.

## Isomorphic loaders are a second leak vector

The rule above is about *what you import*. Some frameworks add a second hazard:
code that **looks** server-side but runs in both places.

TanStack Router/Start **loaders are isomorphic** — they run on the server during
SSR and in the browser on client-side navigation. A loader that imports your
database module directly will typecheck, work perfectly in dev SSR, and then
ship your database driver (and whatever it closes over) to the browser the first
time a user navigates client-side. Nothing warns you, because nothing is
technically wrong: you asked for that module in code that runs on the client.

There is no `'use client'` directive protecting you here, the way RSC frameworks
protect a server component. The fix is to put an explicit server wall inside the
loader:

```ts
// ☠️ the loader imports the server module directly — ships the db on client nav
import { db } from "./db"
export const Route = createFileRoute("/")({
  loader: async () => db.query.spots.findMany(),
})

// ✅ the server wall is a server function; the loader only calls it
const loadSpots = createServerFn().handler(async () => {
  const { db } = await import("./db")          // server-only, never bundled
  return runtime.dehydrate()
})
export const Route = createFileRoute("/")({ loader: () => loadSpots() })
```

The general test applies to any framework: **for every module a client bundle can
reach, ask what it transitively imports.** RSC's `'use client'`/server-component
split answers that question for you; isomorphic loaders make it your job.

## Monorepos and pre-built `packages/api`

If you ship a built `packages/api` (emitted `.d.ts` + `.js`), consumers get the
clean boundary automatically — in **both** dimensions:

- **Runtime**: they import `appContract` from the package's built output; the
  handler code lives in a server entry the client build never touches.
- **Types**: the client's types do **not** drag in your server type graph. The
  client type is derived as `RouterContract<any, TRecord>` — the root context
  (your `db`, your drizzle inference) is matched as `any` and discarded. A
  consumer typechecks client calls even if the server context type is absent
  entirely. You get tRPC-style end-to-end inference **without** a consumer's
  `tsc` chewing through your database types.

So the split that protects your secrets also gives you a fast, decoupled type
boundary — the thing a "nasty server type graph" would otherwise cost you.

## What is safe to expose

The contract *is* your public API surface, and everything in it reaches the
client by design — that is correct and not a leak:

- **Field names and shapes** in your codecs (the client must decode them).
- **Error tags and their data shapes** for declared, `visibility: "public"`
  errors. The compiler rejects private (`visibility: "private"`) definitions
  from procedure, middleware, and layer error maps. They are server-side
  composition currency; the runtime also sanitizes an unsafe cast or
  JavaScript bypass to `server/internal` at the wire.
- **`.affects()`/`.writes()` maps** — these run *on the client* (cache
  invalidation), so they are meant to ship. Keep them pure input→input
  transforms; never close a secret into one.

If a fact would be dangerous in the browser, it does not belong in the contract —
it belongs behind a handler.

`visibility: "private"` controls the error algebra; it is not a bundler
directive. Keep private definitions and the libraries they adapt in a
server-only module. Importing a mixed server error module from the contract can
still pull that module's runtime dependency graph into the browser even though
TypeScript correctly excludes its private errors from `.errors(...)`.

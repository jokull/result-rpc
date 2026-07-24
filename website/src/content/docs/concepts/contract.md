---
title: "Contract and procedures"
description: "Procedures, middleware, and routers: the shared contract both sides close over."
---

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

Middleware definitions also join the handler's `errors` bag, so a handler can
return a middleware-contributed error without re-importing it — but choose
deliberately there: `errors.Unauthorized()` from an ownership check would hand
a 403-shaped outcome to whatever shell owns the auth union (whose reaction is
a sign-in redirect). Not-the-owner is its own domain error.

In contract-first code, middleware errors must already be present in the
shared contract; `app.implement(...).use(...)` rejects an undeclared
contribution. The code-first convenience form unions middleware definitions
automatically. Duplicate tags with different definitions are rejected rather
than silently overridden.

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

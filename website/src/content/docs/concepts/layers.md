---
title: "Layers"
description: "One auth declaration deriving the middleware, the context procedure, and the shell \u2014 nothing left to drift."
---

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

This **replaces** the hand-declared `AuthShell` from the shells section — same
name, same claims, drop-in for every `AuthShell.useQuery` call site — and adds
what the hand-rolled one couldn't have: `AuthShell.Provider` loads the value
through the context procedure (rendering `fallback` until it resolves),
provides it to the subtree, and auto-resumes held work when the value is
re-established. `defineShell` remains the tool for shells that aren't backed
by a context procedure — transport banners, defect boundaries. The load
itself runs under the enclosing shells, so an offline blip during
establishment pauses under the app shell like any other operation; only the
layer's own errors reach `onError`.

The middleware, the endpoint, and the shell all close over the same `provides`
codec and the same error map. There is nothing left to keep in sync.

## Optional layers refine into required ones

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

// No resolver: the refinement is derived. Passing `session` bundles the
// parent, so one `.use(requireViewer)` pulls the whole chain in order.
const requireViewer = ViewerLayer.middleware(app, session)

app.procedure()
  .use(requireViewer)                    // session runs first: viewer is User
  .query(({ context }) => ok(greet(context.viewer)))
```

(`ViewerLayer.middleware(app)` without the parent also works when the input
context already carries the session value — the bundled form is the usual
one.)

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

## Keeping it honest

Narrowing this cheap can quietly become swallowing, so both halves of the
claim are assertable. The absorbed set is a runtime value:

```ts
AuthShell.claimedTags
// ["auth/unauthorized", "auth/session-expired", "client/stale",
//  "client/http-failure", "client/protocol-violation", "client/decode-failure",
//  "server/bad-request", "server/internal", "client/offline",
//  "client/network-failure", "client/timeout"]
```

and the component-visible union is a compile-time probe — a two-line pattern
that pins exactly what a component can be asked to render, forever. This is
the artifact tRPC cannot produce: a test asserting which error codes a call
site can surface.

```ts
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T

// doc.byId resolves a dozen possible failures; under the onion the page sees one.
const probeDoc = () => ViewerShell.useQuery(client.doc.byId, { id: "x" })
type DocQueryError = Extract<ReturnType<typeof probeDoc>, { state: "failure" }>["result"]["error"]
export type _DocPageSeesOnlyNotFound = Assert<Equal<DocQueryError["_tag"], "doc/not-found">>
```

Add an application-namespace tag to a shell and the probe breaks — narrowing
stays a deliberate, reviewable act. `examples/03-docs/app.test.tsx` runs these
against the full onion.

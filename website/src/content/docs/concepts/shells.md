---
title: "Shells"
description: "Error boundaries for values: providers that claim failure classes, pause or escalate, and subtract what they own from component unions."
---

Remember the 401 interceptor. Now recall that React already solved this exact
shape once, for a different kind of failure. Render errors used to be every
component's private problem; error boundaries made them *positional*: throw
anywhere below, and the nearest boundary that claims it takes over. Three
properties made that design stick:

1. **Tree-positional** — ownership follows the UI, not the call site.
2. **It catches errors from components that never heard of it** — a boundary
   that only caught opted-in throws would be useless.
3. **Unclaimed errors fail loudly** rather than vanish.

A shell is the same contract, transplanted from thrown render errors to
failure *values*. A shell is a provider that claims a set of error tags. Any
operation rendered beneath it — no matter which hook issued it — that fails
with a claimed tag is routed to the shell instead of surfacing as component
state. The 401 interceptor becomes a typed declaration with a position in the
tree, and the tags it owns disappear from the unions below it.

## Three tiers of failure, three built-in owners

The tiers are nothing more than which definition map you hand to which shell —
there is no classification field:

| What failed | Example tags | Reaction | The map |
| --- | --- | --- | --- |
| The domain said no | `doc/not-found`, `auth/unauthorized` | the component branches, or an auth shell reacts | your `defineErrors` maps |
| The world flaked | `client/offline`, `client/timeout`, `client/network-failure` | pause, banner, resume | `transportErrors` |
| The contract broke | `client/protocol-violation`, `client/decode-failure`, `server/internal` | escalate to the error boundary | `defectErrors` |
| A deploy left this client behind | `client/stale` | reload — the reload *is* the fix | `staleErrors` |

The framework contributes every non-domain row, so the framework ships their
owners pre-assembled — assembling them by hand was the same ten lines in
every app:

```tsx
import { boundaryShells } from "result-rpc/react"

export const { TransportShell, DefectShell, StaleShell, BoundaryProvider } =
  boundaryShells()
// TransportShell  claims transportErrors, pauses; useHeld() feeds the banner
// DefectShell     claims defectErrors, escalates to the React error boundary
// StaleShell      claims staleErrors; default reaction reloads the page
```

You only ever *write* shells for what the app itself owns:

```tsx
import { defineShell } from "result-rpc/react"
import { authErrors } from "../shared/errors"

export const AuthShell = defineShell({
  name: "auth",
  from: StaleShell,                 // hang off the innermost built-in
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
  <BoundaryProvider>
    <ErrorBoundary fallback={<AppBroken />}>
      <AuthShell.Provider session={session} signOut={signOut}>
        <Routes />
      </AuthShell.Provider>
    </ErrorBoundary>
  </BoundaryProvider>
</ResultRpcProvider>
```

Inside `Routes`, an operation resolving ten possible tags presents one:

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

## How claiming actually works

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
it. The login page lives outside `AuthShell` and handles
`auth/session-expired` as an ordinary failure, because there is no session to
guarantee there.

## The chain is a value, not an inference

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

## What a claimed error does to the operation

A subtracted error never produces `state: "failure"` — that would be a lie
about a union it is no longer in.

With `effect: "pause"` (the default):

- **Query** — returns to a non-terminal state with `fetch: "paused"`. If a
  cached success exists it keeps rendering as `state: "success"`, stale, so a
  session blip does not blank the screen. If not, `state: "pending"`.
- **Mutation** — state returns to `"idle"` and the pending `mutate` promise
  rejects with a **`claimed` control signal**: the caller's continuation was
  written against the narrowed union, so an outcome owned above it must not
  run it. The signal is the same *family* as cancellation — control flow,
  never part of a recoverable union — but deliberately distinguishable,
  because "you cancelled" and "a shell owns this outcome" are different
  events. `isClaimed(reason)` identifies it and carries the claimed tag and
  the owning shell's name (never the error value), so a form can render "you
  were signed out" instead of silently resetting:

  ```ts
  import { isCancelled, isClaimed } from "result-rpc/client"

  try {
    await rename.mutate({ id, title })
  } catch (reason) {
    if (isClaimed(reason)) reason.data // { tag: "auth/session-expired", owner: "auth" }
    else if (isCancelled(reason)) {}   // user cancelled; nothing happened for sure
    else throw reason
  }
  ```
- **Subscription** — `connection` becomes `"paused"` and `result` stays
  `undefined`.

With `effect: "escalate"`, the tagged value is thrown to the nearest React
error boundary — as the structural `TaggedError`, not wrapped in an `Error`,
so the fallback can still `matchError` on it. Escalate is the bridge back to
the machinery React already has.

`onError` fires once per newly claimed error per observer. One logical event —
a revoked session — arrives on every in-flight operation at once, so handlers
must be idempotent (a redirect, a `signOut()`, a toast keyed by tag).

## The pause arc ends in resume

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

## Ambient failures are aggregate, not per-operation

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

## The server declares, the client discharges

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

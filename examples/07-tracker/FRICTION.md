# FRICTION.md — building 07-tracker from the docs alone

Log from a tRPC-habituated engineer building this example against README +
website docs + 01-hello only. Entries in rough discovery order, tagged
**blocker / papercut / docs-gap / delight**.

## Postscript (round two)

Three of the items below drove same-day fixes in the library, and this
example has since been reworked to drop the corresponding workarounds:

- **Blocker #1** (codec-rejected input crashing the mutation engine): fixed.
  `mutate()` now rejects cleanly with the TypeError and the mutation resets
  to `idle` — pinned by the "codec-rejected input … resets to idle" test.
  The contract is now understood and stated plainly in the app: invalid
  input on a same-version client is a caller bug (the form pre-validates
  with the same Standard Schema); `server/bad-request` is for requests that
  actually cross the wire, demonstrated by the stale-shaped-client test.
- **Blocker #2** (inline mutation options infinite loop): fixed — hooks read
  options through a ref. `NewIssueForm` now passes inline options and inline
  callbacks, exactly as the docs write them, with no incident.
  (`MutationOptions` and `QueryCache` are also exported now.)
- **Papercut #4** (client proxy throwing under introspection): fixed — the
  proxy is inert off router paths. The app-owned ClientContext workaround is
  gone; components use `useResultClient<AppClient>()` and the test harness
  passes the client as an ordinary prop, with no incident.

The entries below are kept as written: they are the historical record the
fixes came from.

---

## 1. [blocker] `wire.standard` rejection on the same-version client THROWS — and crashes the mutation engine

What I did: wired the forms-guide flow verbatim — `wire.standard(schema)` as
the create input, `fieldIssues(result.error)` on `server/bad-request` — and
submitted an invalid title through `useResultMutation`.

What happened, in two stages:

1. The direct client **throws** `TypeError: Invalid input for issues.create:
title: Title must be at least 3 characters` at the encode preflight. The
   pitch ("a client whose every call resolves `Result` — never a thrown
   transport error on the side") has an undocumented carve-out: _invalid input
   is a programmer error and throws_. Defensible stance — but it must be
   written down, because the forms guide reads as if `server/bad-request` is
   the normal outcome of submitting a bad value.
2. Through `useResultMutation` it is worse than a throw: the mutation engine
   crashes with `TypeError: Mutation engine received an untagged failure`
   (src/query/runtime.ts, via the observer notify path). That is an
   app-crashing failure reachable by _user input_ whenever a form field feeds
   a `wire.standard` input without duplicate client-side validation. This one
   is a bug, not a doc gap: the engine should either surface the preflight
   rejection as a tagged value or reject the `mutate` promise cleanly.

What the docs should say: the `server/bad-request → fieldIssues` arc only
exists for requests that actually cross the wire — i.e. clients whose codec
is out of sync with the server (deploy skew, hand-rolled callers). A
same-version client never sends the invalid request. The test file proves the
real arc with a deliberately loose "stale-shaped" client and `contractVersion`
pinned on both sides.

Where it should live: guides/forms.md (a "when does bad-request actually
happen" section) + concepts/client.md (the throw carve-out).

## 2. [blocker] Inline `useResultMutation` options cause an infinite render loop

`useResultMutation(client.issues.create, { optimistic: ..., onFailure: ... })`
with the options object written inline — the way every mutations-doc example
writes it, and the way three years of React Query habit writes it — dies with
"Maximum update depth exceeded". The hook appears to resubscribe on options
identity, and a new object per render loops forever.

Workaround: `useMemo` the options. But extracting them from the call site
loses contextual typing, and neither `MutationOptions` nor the optimistic
`cache` parameter type is exported/documented, so I hand-wrote a structural
type for `cache.update` (app.tsx, `createOptions`). Either the hook should
tolerate unstable options (React Query does), or the docs must say "options
must be referentially stable" and export the types needed to hoist them.

Where it should live: concepts/mutations.md, and the react entrypoint's type
exports.

## 3. [docs-gap] No story for simulating connectivity in tests — and listeners attach to `globalThis`, not `window`

The offline requirement ("paused, not failed, auto-resume on online") is a
headline feature, and the testing guide covers parity clients and
fetch-handler-as-fetch — but says nothing about driving the connectivity arc
in a non-browser test runner. Bun has no `window` and `navigator.onLine` is
undefined, so I built stubs. They silently did nothing: dispatching
`offline`/`online` on my `window` stub never reached the library.

**Logged doc-failure peek:** after 3+ blind attempts (window stub, navigator
override, document stub, instrumenting `EventTarget.prototype`), I read
`src/connectivity.ts` — the one source peek this exercise needed. Findings a
testing doc should own:

- Listeners attach to **`globalThis`** (in a browser that _is_ `window`; in
  Bun it is not).
- The online snapshot is seeded from `navigator.onLine` **at module import**
  and is event-driven afterwards — so test setup must be imported before the
  library and must _dispatch events_, not just flip `navigator.onLine`.
- Listeners attach lazily on first subscriber, so events dispatched before
  mount are lost.

Ten lines in guides/testing.md ("simulating offline") would have saved the
whole detour. Once wired, the semantics themselves were exactly as advertised
(see delight #9).

## 4. [papercut] The client proxy throws when introspected — react-test-renderer dev logging kills the whole test file

react-test-renderer 19's dev-mode component-performance logging walks props,
reads `.name` on function-valued props and coerces with `.valueOf()`. The
client proxy returns a sub-proxy for `name` and then **throws** `TypeError:
Unknown procedure name.valueOf` when the tooling invokes it. The throw lands
inside React's commit phase and poisons the scheduler — every subsequent test
in the file fails with "Should not already be working", which made the first
diagnosis miserable (the reported failing tests were innocent).

Workaround: never pass the client (or a procedure) as a component prop;
thread it through an app-owned React context (app.tsx does this, with a
comment). The proxy should probably return `undefined` for well-known
introspection keys (`valueOf`, `toJSON`, `Symbol.toPrimitive`, `name`/`length`
sub-paths) instead of minting a callable that throws. At minimum: a sharp-edges
bullet, since the recommended test stack is exactly bun + react-test-renderer.

## 5. [docs-gap] The forms guide and the boundary onion contradict each other about `server/bad-request`

`defectErrors` (claimed by `DefectShell`, escalate-to-boundary) includes
`server/bad-request`. Claiming is positional — plain hooks don't opt out — so
under the recommended `boundaryShells()` onion **no form can ever branch on
`server/bad-request`**: the narrowed hooks remove it from the type, and even
`useResultMutation` gets a `claimed` rejection instead of a Result. The forms
guide's `if (result.error._tag === "server/bad-request")` example only works
for a form rendered _outside_ the DefectShell, which the guide never mentions.
My form is mounted outside the boundary subtree for exactly this reason.
Either `boundaryShells` needs an option to leave bad-request unclaimed, or the
forms guide needs a loud "mount your form outside the defect shell (or catch
`isClaimed`)" paragraph.

## 6. [papercut] Assorted small snags

- `error()`/`defineErrors` require `httpStatus` even for server-internal
  definitions that never cross the wire (my granular upstream errors). The
  results.md example happens to include 502s so I only hit it by omission;
  the TS error (`missing in type ... ErrorSpec<any, any>`) doesn't say _why_
  a status is mandatory for an error that has no HTTP life.
- `InputOf` yields `readonly` fields — right for wire values, but a mock db
  wants mutable rows; I hand-rolled `Mutable<T>`. Worth a sentence or an
  exported helper.
- The `defineErrors` key→tag conversion (camelCase key → kebab-case tag
  segment: `titleTaken` → `issue/title-taken`) is only _implied_ by one
  example (`notFound` → `doc/not-found`). I guessed and verified at runtime.
  One explicit sentence, please — shells claim by tag and tests assert tags,
  so getting this wrong fails at a distance.
- Every no-input query still needs `.input(wire.object({}))` and `{}` at each
  call site. tRPC lets you omit input; minor but constant ceremony.
- `contractVersion` precedence is ambiguous in the deploys doc: it turns out
  (empirically — my loose-client test relies on it) that matching
  `contractVersion` strings suppress stale reclassification even when the
  structural digests differ. That is exactly what I needed, and it deserves a
  sentence, because the whole loose-client/fieldIssues story hangs off it.

## 7. [delight] The type inference held up under blind fire

I wrote ~700 lines against APIs I had only read prose about — layer contract

- `SessionLayer.procedure(app, contract, middleware)`, `layerShell` with a
  `procedure:` _selector_, `.affects()` contract-first, `touch(Project, id)` in
  a handler, `wire.standard` over a hand-rolled Standard Schema object,
  `errorCatalog` over a shell-narrowed union — and the first full `tsc` pass
  had **two** real errors (a missing `httpStatus`, readonly rows). Everything
  else — including `ViewerShell.use()` returning `User` with no null, and the
  narrowed `switch` exhaustiveness in every component — compiled exactly as the
  docs promised. I have never had a first-contact experience like that with
  tRPC middleware/context typing.

## 8. [delight] The flagship entity behavior worked first try, and the counts prove it

`assign` returns `Issue.codec`; the list row AND the detail header update
with `issues.list === 1, issues.byId === 1` — zero refetches, no `onSuccess`,
no `setQueryData`, at no call site. `close` + `touch(Project, id)` refetched
exactly the projects query and nothing else. This is the tRPC + React Query
pain (the invalidation whack-a-mole) genuinely deleted, and the test that
proves it is assertions over request counters, not vibes.

## 9. [delight] Offline semantics are honest

Once the connectivity stub was wired (item 3): a query mounted while offline
sat at `pending / fetch: "paused"` — zero wire calls, zero retry burn, no
failure state — the banner switched on `useConnectivity()`, and a single
`online` event resumed it to success with exactly one request. "Offline is
lifecycle before it is failure" is real, and the exhaustive three-state
banner switch is nicer than anything I've hand-rolled over
`navigator.onLine` + React Query's `onlineManager`.

## 10. [delight] Compile-time error-surface probes

The `Equal`/`Assert` probe pattern from the layers doc pinned "the issue page
can only ever be asked to render `issue/not-found | project/forbidden`" and
"the list component cannot fail in component space" as type-level tests. That
artifact — _which error codes can this call site surface_ — is something I
have wanted in every tRPC review I've ever done.

---

**Source peeks (each one a documentation failure by contract):**

1. `src/connectivity.ts` — looking for how to simulate offline in tests;
   should have been in guides/testing.md. (Only deliberate peek; items 1, 2
   and 4 were diagnosed from public behavior and stack traces alone.)

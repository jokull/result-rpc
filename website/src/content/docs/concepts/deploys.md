---
title: "Deploys and stale clients"
description: "Contract digests, skew detection, and client/stale: the compatibility window as a detected, owned state."
---

Every deploy opens a compatibility window: new server, old tabs. In most
stacks the window is invisible — a stale client's failures are
indistinguishable from bugs (bad requests, decode failures), Sentry counts
every deploy as an incident spike, and the "fix" is a user who happens to
press reload. Closed unions make the window *more* acute, not less: a stale
client cannot even decode an error tag added after it was built.

result-rpc makes the window a detected, owned state:

1. The server stamps every response with a digest of its contract —
   procedure paths, kinds, and every error tag with its policy
   (`x-result-rpc-contract`). A router and the contract it implements digest
   identically; nothing to configure.
2. The client compares the stamp to its own digest. The first mismatch emits
   a `skew` ClientEvent — observability sees the drift before anything fails.
3. When a request **fails** with a contract-shaped tag (`server/bad-request`,
   `client/decode-failure`, `client/protocol-violation`,
   `client/http-failure`) *while the digests differ*, the failure is
   reclassified as `client/stale`, carrying the original tag. Matching
   digests change nothing — a real defect stays a defect, and successful
   calls are never touched.

And `client/stale` has a built-in owner: the boundary's `StaleShell` claims
it, holds the affected operations, and reacts — by default with a page
reload, because the reload fetches the current client, which *is* the fix.
Override it to taste:

```tsx
const { BoundaryProvider } = boundaryShells({
  onStale: () => toast("A new version is available", { action: reload }),
})
```

The automatic digest reads what codecs expose, so a field-level change inside
an object codec does not flip it on its own (the failure it causes usually
travels with a visible change — but not always). For per-deploy exactness,
stamp both sides with the build:

```ts
createFetchHandler({ router, contractVersion: BUILD_SHA, ... })
createClient({ contract, contractVersion: BUILD_SHA, ... })
```

Detection is failure-gated, so the coarser stamp is safe: matching successful
calls are never reclassified.

Deploys then stay boring the same way database migrations do: **expand, then
contract**. Ship additive changes first (new procedures, new tags — old
clients never call what they don't know about), and make removals and
reshapes a later deploy, after the previous client generation has drained.
When a stale tab does cross the window, it reloads once instead of
mis-reporting a bug. This is the same discipline
[onwardpg](https://github.com/jokull/onwardpg) enforces for the database tier
— expand while old code is live, contract after it drains — applied one
level up, between the server and the browsers it left behind.

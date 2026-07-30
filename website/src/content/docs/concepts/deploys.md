---
title: "Deploys and stale clients"
description: "Contract digests, skew detection, and client/stale: the compatibility window as a detected, owned state."
---

Every deploy opens a compatibility window: new server, old tabs. In most
stacks the window is invisible — a stale client's failures are
indistinguishable from bugs (bad requests, decode failures), Sentry counts
every deploy as an incident spike, and the "fix" is a user who happens to
press reload. Closed unions make the window _more_ acute, not less: a stale
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
   `client/http-failure`) _while the digests differ_, the failure is
   reclassified as `client/stale`, carrying the original tag. Matching
   digests change nothing — a real defect stays a defect, and successful
   calls are never touched.

And `client/stale` has a built-in owner: the boundary's `StaleShell` claims
it, holds the affected operations, and reacts — by default with a page
reload, because the reload fetches the current client, which _is_ the fix.
Override it to taste:

```tsx
const { BoundaryProvider } = boundaryShells({
  onStale: () => toast("A new version is available", { action: reload }),
});
```

The automatic digest is structural: built-in codecs contribute their complete
nested shape, constraints, literals, model projections, and error-data schemas.
Adopted Standard Schemas and guarded serializable values contribute their
application-owned stable schema `id`. A field-level contract change therefore
changes the digest. You may instead make a build stamp the effective version on
both sides:

```ts
createFetchHandler({ router, contractVersion: BUILD_SHA, ... })
createBrowserClient({ contract, contractVersion: BUILD_SHA, ... })
```

Detection is failure-gated, so matching successful calls are never
reclassified.

`contractVersion` _replaces_ the structural digest entirely — it does not
combine with it. Matching version strings on both sides suppress stale
reclassification even when the underlying shapes differ, which is exactly
the escape hatch a deliberately loose client (a canary, a test double, a
tolerant reader during an expand window) needs.

The whole mid-deploy arc is pinned as a runnable test in
`examples/07-tracker`: a deliberately _stale-shaped_ client — the old
deploy, no schema preflight — sends a bad request across the real wire, the
server's input decode rejects it, and `server/bad-request` comes back
projected onto form fields with `fieldIssues`, asserted at exactly one wire
call. The failure mode every production app has during a rollout, and the
one no framework's docs can usually demonstrate.

Deploys then stay boring the same way database migrations do: **expand, then
contract**. Ship additive changes first (new procedures, new tags — old
clients never call what they don't know about), and make removals and
reshapes a later deploy, after the previous client generation has drained.
When a stale tab does cross the window, it reloads once instead of
mis-reporting a bug. This is the same discipline
[onwardpg](https://github.com/jokull/onwardpg) enforces for the database tier
— expand while old code is live, contract after it drains — applied one
level up, between the server and the browsers it left behind.

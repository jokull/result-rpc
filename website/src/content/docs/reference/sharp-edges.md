---
title: "Sharp edges"
description: "Named here so they are not discovered at 2am: reference identity, HMR, digests, control-flow rejections."
---

Named here so they are not discovered at 2am:

- **Reference identity under hot reload.** Services, middleware dedup, and the
  error-tag registry all key on module-constant reference identity. HMR that
  re-evaluates a definition module creates new identities; the router build
  will reject a tag re-registered with a different definition rather than
  silently duplicating it, but the reliable dev-mode rule is: keep
  definitions in leaf modules and let edits to them trigger a full reload.
  Two copies of result-rpc in one bundle (monorepo resolution mistakes) break
  identity the same way they break React context — dedupe the package.
- **No React Query devtools.** The cache engine is `@tanstack/query-core`
  used privately, so the React Query devtools, persisters, and ESLint plugin
  do not apply. The current inspection surface is the client `onEvent` stream
  (every call, failure, retry, and claim, with its owning shell); a dedicated
  devtools panel — including "which shell claimed this error and why" — is
  planned but not shipped.
- **Control-flow rejections.** `await mutate(...)` can reject with
  `cancelled` or `claimed`. Call sites that await mutations need the same
  `try/catch` discipline they need for aborts; fire-and-forget call sites
  (`void mutate(...)`) should `.catch(() => {})` the control signals.
- **The contract is a value.** Unlike tRPC's type-only client, the browser
  bundle carries the contract's codecs and the devalue serializer. That is
  the price of rich values and client-side validation; it is a real number of
  kilobytes, and worth measuring in your bundle before committing.
- **An inline `wire.object` collects no identity.** Entity updates only see
  outputs composed from model codecs (`Doc.codec`, `Doc.pick(...)`) — a
  hand-rolled shape opts out silently. Model identity is reference identity,
  same rule as services and middleware: one `defineModel` in a module
  constant; two calls are two models.
- **The automatic contract digest is shape-coarse.** It flips on paths, kinds,
  and error unions — not on field-level codec edits. If your deploys routinely
  change only object fields, stamp both sides with `contractVersion` (a build
  SHA) so stale-client detection is exact; it is failure-gated either way.
- **Two caches during a tRPC coexistence period** — see the migration section.

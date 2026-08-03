---
title: "FAQ"
description: "The decisions behind the boundary union, the better-result peer dependency, and class identity."
---

## Why must procedure handlers return `DeclaredProcedureErrors` and not any tagged error?

A procedure handler returns `Result<Output, DeclaredProcedureErrors>` — the
exact union of definitions declared on that procedure. Allowing
`Result<Output, AnyTaggedError>` would cost more than it saves:

- **The compile-time contract is the feature.** The closed union is what makes
  `switch (query.error._tag)` exhaustive and what shells subtract. A handler
  returning an undeclared tag would compile, then the boundary would sanitize
  it to `server/internal` — the type says one error, the wire says another.
  That divergence is worse than a compile error.
- **Sanitization is a backstop, not a policy.** The runtime registry check
  exists because `any`, assertions, and malformed returns bypass typing. It is
  defense-in-depth for the type layer, not a replacement for it.
- **Derived unions accumulate from declared sets.** Middleware, layer, and
  shell unions only grow what is declared; an open error channel leaks
  undeclared tags into them.

This is a _boundary_ decision, not a runtime one — framework-internal paths
use `Result<unknown, AnyTaggedError>` freely. Only the public procedure
contract is closed. See ARCHITECTURE.md, "Why the boundary union is closed".

**"But my upstream better-result Result has a different error?"** If the error
is already a result-rpc tagged error, declare it in `.errors({ ... })` and
return it zero-copy. If it is foreign, fold it with `mapError` before the
boundary — the documented adoption workflow.

## Why is better-result a peer dependency?

Class identity. result-rpc's boundary validates handler returns with
`instanceof` on better-result's `Ok`/`Err` classes, and zero-copy adoption
requires that the Result you construct in your app is the same `Ok`/`Err`
class result-rpc's boundary checks. A regular nested dependency can silently
give the app two copies of better-result (resolver divergence, an alias, a
bundler dedupe miss) — and then your Results are rejected as counterfeit.

A `peerDependencies: { "better-result": "^3.0.0" }` entry makes the sharing
structural: one copy, resolved by your app, consumed by result-rpc. npm ≥ 7
and pnpm auto-install peers, so there is no extra install step for apps that
do not use better-result directly — and the packaged smoke test verifies the
packed tarball resolves it.

## Do Results survive arbitrary serializers?

No. The client reconstructs a Result and its exact declared error only when
it has the procedure's output codec and error registry — i.e. through the
per-procedure Result codec over HTTP or a parity client. Naive JSON, Next
server actions/RSC props, and unrelated serializers cannot reify the runtime
types. Unwrap (`result.isErr() ? ... : result.value`) before crossing one of
those boundaries.

## Is the result of a callback that throws ever a domain error?

No. Exceptions thrown by Result callbacks become better-result `Panic`
defects. The procedure boundary sanitizes them to `server/internal` with a
fresh incident id; the wire never sees the panic message, stack, or cause.
The full Panic reaches server-side observability (`onInternalError`) for
incident detail.

---
title: "Observability"
description: "Four taps, one per tier \u2014 a redaction-safe wire stream, shell reactions, and policy-aware server hooks."
---

The footgun: a Sentry event that says `TRPCClientError: UNAUTHORIZED` with a
stack that points into library code, and a dashboard you reconstruct from
string codes after the fact. When observability is table stakes, "which
operation, which tag, who owned it, what did the server actually see" cannot
be archaeology.

Every observable moment is already a value at a known choke point, so
observability is one structured stream plus adapters — never an integration
that fights the framework. Four taps, one per tier:

```ts
// 1. Wire: every call, retry, claim — paths, tags, timing; never values.
const client = createClient({
  contract,
  transport,
  onEvent: (event) => Sentry.addBreadcrumb({
    category: `rpc.${event.type}`,
    message: event.path,
    level: event.type === "failure" ? "warning" : "info",
    data: event,
  }),
})
// event: call | success | failure | retry | skew
//      | claimed  ← a shell took ownership: { path, tag, owner, effect }

// 2. Ownership: a shell's reaction is a reporting moment.
const AuthShell = layerShell(AuthLayer, {
  from: DefectShell,
  procedure: (client: AppClient) => client.auth.me,
  onError: (error) => {
    Sentry.captureMessage(`signed out: ${error._tag}`, "info")
    redirect("/login")
  },
})

// 3. Server, declared errors: policy included, so severity routes the sink.
createFetchHandler({
  router,
  onError: ({ error, policy, procedurePath, httpStatus }) => {
    metrics.increment(error._tag, { status: httpStatus })
    if (policy?.severity === "error") Sentry.captureMessage(error._tag)
  },
  // 4. Server, defects: the only place causes and stacks exist.
  onInternalError: ({ incidentId, cause, procedurePath, phase }) => {
    Sentry.captureException(cause, { tags: { incidentId, procedurePath, phase } })
  },
})
```

The wire stream is redaction-safe by construction: events carry paths, tags,
durations, owners — never inputs or outputs — so forwarding it verbatim to a
third-party tracker is not a data decision.

For inline observation of a single Result, the tap combinators return the
original value unchanged:

```ts
tapError(await client.doc.rename(input), (error) => log.warn(error._tag))
// also: tap(result, fn), tapBoth(result, { ok, error })
```

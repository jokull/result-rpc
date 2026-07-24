---
title: "Bring your own router"
description: "Shells are providers and hooks; routes-as-shells and prefetch loaders are sixty lines of app-owned glue."
---

result-rpc deliberately ships no router integration: shells are providers and
hooks, so they compose with any router (TanStack Router, Next, Waku, React
Native navigation) without the library knowing routers exist. The natural
mapping — layout route = shell, route loader = `runtime.prefetch`,
`errorComponent` = escalate target — is roughly sixty lines of app-owned glue;
`examples/05-router-glue/router-glue.tsx` is a complete copy-paste integration
for TanStack Router, including auto-derived loaders that prefetch a layer's
context procedure before its route commits.

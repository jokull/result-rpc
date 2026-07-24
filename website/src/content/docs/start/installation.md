---
title: "Installation"
description: "One versioned package with one entry per runtime; the root is the contract language."
---

```sh
npm install result-rpc
```

One versioned package, one entry per runtime — the root is everything
isomorphic (the contract language):

```ts
import { rpc, error, errorCatalog, err, ok, wire, defineLayer, defineService, resolveServices, type RouterInputs, type RouterOutputs } from "result-rpc"
import { createFetchHandler } from "result-rpc/server"
import { batchFetchTransport, createClient } from "result-rpc/client"
import { defineShell, layerShell, ResultRpcProvider, useResultQuery } from "result-rpc/react"
```

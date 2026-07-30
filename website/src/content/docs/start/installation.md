---
title: "Installation"
description: "One versioned package with one entry per runtime; the root is the contract language."
---

```sh
npm install result-rpc
```

Use Node 20 or newer and TypeScript 5.4 or newer. The published declaration
surface is tested with TypeScript 5.4, 5.9, and 7.0.

One versioned package, one entry per runtime — the root is everything
isomorphic (the contract language):

```ts
import {
  rpc,
  error,
  errorCatalog,
  err,
  ok,
  wire,
  defineLayer,
  defineService,
  resolveServices,
  type RouterInputs,
  type RouterOutputs,
} from "result-rpc";
import { createFetchHandler, serverRpc } from "result-rpc/server";
import { batchFetchTransport, createBrowserClient } from "result-rpc/client";
import { defineShell, layerShell, ResultRpcProvider, useResultQuery } from "result-rpc/react";
```

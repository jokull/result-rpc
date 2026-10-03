---
"result-rpc": patch
---

Remove the `postinstall` script from the published package. It ran `bun run build` inside the consumer's `node_modules/result-rpc`, which fails (`bun` or `tsdown` not found) on any package manager that runs dependency lifecycle scripts, such as npm 10. The package ships a prebuilt `dist`, so no install-time build is needed.

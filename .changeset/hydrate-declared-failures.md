---
"result-rpc": patch
---

**A declared domain failure now dehydrates and hydrates.** An RSC prefetch of a row that does not exist renders its `not-found` state on first paint at zero client requests, instead of server-rendering an empty body and only answering after a round trip. The failure comes back reified through the procedure's error registry, so it narrows, matches, and is claimed by shells exactly as a live one is.

Framework and transport failures (`client/*`, `server/*`) are still excluded: they describe one attempt on one machine, and baking one in would replace a fetch the browser can retry with a verdict it cannot.

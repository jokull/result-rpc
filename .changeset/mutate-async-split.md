---
"result-rpc": minor
---

**Breaking: `mutate()` no longer returns a `Result`.** It returns `void` and never rejects. The awaiting form is now `mutateAsync(input)`, which returns `Promise<Result<…>>` and rejects with the `cancelled` and `claimed` control signals as `mutate` used to.

This is the split TanStack Query established, and it exists because the old single call could not be both. A fire-and-forget call site has nowhere to put a rejection: our own documented `onChange={(e) => void assign.mutate({ … })}` was an unhandled rejection the moment any mounted shell claimed the failure, and was correct only in an app where nothing claimed.

To migrate: **add `Async` wherever you awaited the result.** Call sites that did not await — including any that carried a `.catch(() => undefined)` to swallow control signals — can drop the incantation and stay on `mutate`.

```diff
- const result = await rename.mutate({ id, title });
+ const result = await rename.mutateAsync({ id, title });

- void assign.mutate({ issueId, assigneeId }).catch(() => undefined);
+ assign.mutate({ issueId, assigneeId });
```

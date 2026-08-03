---
"result-rpc": minor
---

Add `wire.enum(["open", "closed"])` for non-empty string literal unions. It
infers the literal union without `as const` and preserves the contract identity
of the equivalent `wire.union` of `wire.literal` codecs.

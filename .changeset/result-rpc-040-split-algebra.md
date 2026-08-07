---
"result-rpc": major
---

Stop re-exporting the better-result algebra. `gen`, `map`, `mapError`, `andThen`, `match`, `matchError`, `tap`, `tapError`, `tapBoth`, `all`, `tryRecover`, `unwrap`, `unwrapOr`, `tryCatch`, `tryPromise`, `isOk`, and `isErr` are no longer exported from `result-rpc` — they were better-result's, re-exported unchanged, and the single import surface blurred the ownership line between the two packages (`gen` looked like a result-rpc primitive but is better-result's generator).

The algebra now comes from better-result:

```ts
import { Result, matchError } from "better-result"; // the algebra
import { ok, err, server, contract, defineErrors } from "result-rpc"; // the boundary
```

Migrate: `gen(fn)` → `Result.gen(fn)`, `map(r, f)` → `Result.map(r, f)`, `andThen(r, f)` → `Result.andThen(r, f)`, `tryCatch(o)` → `Result.try(o)`, `isErr(x)` → `Result.isError(x)` (better-result's guard static is `isError`, not `isErr`), and so on. `matchError` is unchanged in call shape, imported from better-result.

`ok`/`err` stay on result-rpc — they are the boundary's constrained construction primitives (`err` rejects non-tagged errors at construction), and the constrained types (`Result`, `Ok`, `Err`, `InferErr`, `InferOk`, `GenErr`) stay. Handlers fold foreign error lanes into declared tags themselves; the `.handler()` return type — not a re-export — is the compiler-checked enforcement.

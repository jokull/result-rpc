---
"result-rpc": patch
---

**`$satisfies` no longer fails on `readonly`.** Model types are compared modulo `readonly`, so a codec decoding to `readonly string[]` matches a source column typed `string[]`. Wire codecs decode readonly by design, so this fired on correctly-aligned schemas — a false positive.

Nullability strictness is unchanged: `string` against `string | null` is still a mismatch. The diagnostic now names every offending field and prints both sides as literal text rather than as a structural type the compiler would collapse to an alias name.

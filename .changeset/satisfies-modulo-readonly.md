---
"result-rpc": patch
---

**`$satisfies` no longer fails on `readonly`.** Model types are compared modulo `readonly`, so a codec decoding to `readonly string[]` matches a source column typed `string[]`. Wire codecs decode readonly by design, so this fired on correctly-aligned schemas — a false positive.

Nullability strictness is unchanged: `string` against `string | null` is still a mismatch. The diagnostic now names every offending field and prints both sides as literal text rather than as a structural type the compiler would collapse to an alias name. It appears directly on the bare `.$satisfies<Source>()` call; no hover or deliberately wrong argument is needed to reveal it.

In a project compiled without `strictNullChecks`, the message is now readable rather than TS2589 ("Type instantiation is excessively deep and possibly infinite"), and it says outright that nullability was not compared — because without that flag the compiler cannot tell a nullable column from a non-nullable one, and that is most of what this assertion exists to check.

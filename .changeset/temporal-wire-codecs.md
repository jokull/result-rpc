---
"result-rpc": minor
---

Add `wire.codec`, a transformation codec factory, and native Temporal wire codecs.

`wire.codec({ id, wire, encode, decode })` builds a codec whose application value differs from its wire value — the canonical example is a calendar date: the domain speaks a `{ year, month, day }` record, the wire speaks `"2026-08-07"`. The factory composes through the declared `wire` codec on both sides (an encoded value the wire codec rejects never reaches the serializer; garbage never reaches the custom decoder) and its schema digest is `codec(<id>, <wire schema>)`, so the contract fingerprint changes with either.

The eight calendar- and clock-oriented Temporal classes — `plainDate`, `plainDateTime`, `plainTime`, `plainYearMonth`, `plainMonthDay`, `instant`, `zonedDateTime`, `duration` — are now native wire citizens, equal to `date`: devalue carries each as its canonical ISO string and revives it with `Temporal.X.from`. The serializer imports `temporal-polyfill/global`, so revival works on runtimes without native Temporal (and never shadows a native one). `Temporal.TimeZone` and `Temporal.Calendar` are identifier strings in the spec and travel as plain `wire.string`.

`success` and `failure` (the `DecodeResult` constructors) are now exported for custom codec authors.

---
"result-rpc": minor
---

Add `wire.codec`, a transformation codec factory, and `wire.temporal`, the Temporal suite.

`wire.codec({ id, wire, encode, decode })` builds a codec whose application value differs from its wire value — the canonical example is a calendar date: the domain speaks `Temporal.PlainDate`, the wire speaks `"2026-08-07"`. The factory composes through the declared `wire` codec on both sides (an encoded value the wire codec rejects never reaches the serializer; garbage never reaches the custom decoder) and its schema digest is `codec(<id>, <wire schema>)`, so the contract fingerprint changes with either.

`wire.temporal` covers all eight calendar/clock classes — `plainDate`, `plainDateTime`, `plainTime`, `plainYearMonth`, `plainMonthDay`, `instant`, `zonedDateTime`, `duration` — each projected to its canonical ISO string and rebuilt with `Temporal.X.from`. `Temporal.TimeZone` and `Temporal.Calendar` are identifier strings in the spec and travel as plain `wire.string`.

`success` and `failure` (the `DecodeResult` constructors) are now exported for custom codec authors.

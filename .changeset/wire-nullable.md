---
"result-rpc": minor
---

**Added `wire.nullable(codec)`**, the union that was being written by hand. It builds `wire.union([codec, wire.null])`, so the encoding and the contract digest are unchanged.

---
"result-rpc": minor
---

Require Node.js 22.18 or newer and move the wire serializer to devalue 6.

Node 20 is end-of-life and devalue 6 requires Node 22.17 (and the build toolchain 22.18), so `engines.node` is now `>=22.18.0` (was `>=20.19.5`). The serialized wire format is unchanged — result-rpc only uses devalue's `stringify`/`parse`, not the `uneval` replacer API that changed in 6.0 — except that unpaired UTF-16 surrogates in strings are now escaped so payloads survive UTF-8 transport. devalue 5.9.3's hardening also comes along: null-prototype keys can no longer bypass the `__proto__` check in `parse`, revived typed-array buffers are validated, and Node `Buffer`s serialize only their visible bytes.

Also bumps `@tanstack/query-core` to `^5.104.0` and `temporal-polyfill` to `^1.0.5`.

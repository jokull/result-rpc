---
title: "Coding-agent start"
description: "Coding agents: begin at https://result-rpc.com/skill.md, then follow its task router before writing code."
---

Use the canonical [`result-rpc` skill](https://result-rpc.com/skill.md) as the entry point for an
unfamiliar codebase. It is generated from the same `SKILL.md` that ships in the
npm package, so the public and installed instructions cannot drift.

<Visibility for="agents">

## Route before writing

- New integration: `/start/quickstart.md`
- Browser code: `/concepts/client-boundary.md`
- Handler calls fetch, a database, filesystem, or SDK:
  `/concepts/results.md` and `/concepts/errors.md`
- React query state or cache: `/concepts/react.md`
- `Date`, `Map`, `Set`, `BigInt`, or custom values: `/concepts/wire.md`
- Mutation invalidation or optimistic state: `/concepts/mutations.md`
- App-wide auth, access, or offline behavior: `/concepts/shells.md` and
  `/concepts/layers.md`

</Visibility>

## Machine-readable surfaces

Blume exposes each page through several equivalent agent-facing interfaces:

- [`/skill.md`](https://result-rpc.com/skill.md) — the canonical task router and guardrails.
- [`/llms.txt`](https://result-rpc.com/llms.txt) — the compact documentation index.
- [`/llms-full.txt`](https://result-rpc.com/llms-full.txt) — the complete agent-oriented corpus.
- Append `.md` to any documentation route for the page's Markdown.
- [`/agent-readability.json`](https://result-rpc.com/agent-readability.json) — discovery metadata
  for every enabled machine-readable surface.
- [`/.well-known/mcp.json`](https://result-rpc.com/.well-known/mcp.json) — the hosted, read-only MCP
  server discovery document.

The page-actions menu also offers **Copy as Markdown**, **Open in chat**, and
**Connect to MCP**. The documentation's source Markdown remains authoritative
across all of them.

## Install the packaged skill

After installing `result-rpc`, link the skill into the convention your coding
agent reads. See [Agent skill](/reference/agent-skill/) for Codex and Claude
Code commands, copy alternatives, and verification.

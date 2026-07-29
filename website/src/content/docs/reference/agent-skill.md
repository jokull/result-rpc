---
title: "Agent skill"
description: "Teach your coding agent result-rpc — a progressively-discoverable skill that maps into these docs, which every agent can read as Markdown."
---

result-rpc ships an [agent skill](https://code.claude.com/docs/en/skills) so a
coding agent (Claude Code and compatible tools) knows the library's rules —
especially the [client-boundary](/concepts/client-boundary/) safety rule — and
knows where to read the rest.

The skill is deliberately thin. It carries stable orientation plus the one
non-negotiable rule inline, then a task→page map into this documentation. The
docs are the single source of truth; the skill routes the agent to them. That
means there is no second copy of the details to keep in sync — update a doc
page, and the skill still points at it.

## These docs are agent-readable

Every page here is also served as raw Markdown — append `.md` to any URL:

- Page Markdown: `https://result-rpc.com/concepts/pagination.md`
- Index for LLMs: `https://result-rpc.com/llms.txt`
- Full corpus: `https://result-rpc.com/llms-full.txt`

So an agent with web access can read the whole documentation set directly,
whether or not the skill is installed. The skill just gives it the map and the
guardrails up front.

## Installing the skill

The skill ships inside the npm package at
`node_modules/result-rpc/skills/result-rpc/SKILL.md`. Make it available to your
agent by linking it into your project's skills directory:

```bash
mkdir -p .claude/skills
ln -s ../../node_modules/result-rpc/skills/result-rpc .claude/skills/result-rpc
```

A symlink keeps the skill current: when you upgrade `result-rpc`, the skill
upgrades with it. Copy the directory instead if your tooling doesn't follow
symlinks.

Once linked, an agent working in your repo discovers the skill by its
description and pulls in the client-boundary rule and the page map before it
writes contract, client, or handler code.

## What the skill enforces

The skill front-loads the rules that are easy to get wrong and expensive to get
wrong:

- **Build the browser client from a `contract()`, never the router** — the
  [client boundary](/concepts/client-boundary/) rule, because a value import of
  server code ships handlers and secrets to the browser.
- Errors are declared, closed, and returned — not thrown.
- The contract is the error registry; shells index by tag and claim exact definitions.
- Mutations declare their blast radius in the contract.

Everything else it defers to the page map, fetched as Markdown on demand.

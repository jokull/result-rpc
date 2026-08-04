---
title: "Agent skill"
description: "Teach your coding agent result-rpc — a progressively-discoverable skill that maps into these docs, which every agent can read as Markdown."
---

result-rpc ships an [agent skill](https://code.claude.com/docs/en/skills) so a
coding agent (Codex, Claude Code, and compatible tools) knows the library's rules —
especially the [client-boundary](/concepts/client-boundary/) safety rule — and
knows where to read the rest.

The skill is deliberately thin. It carries stable orientation plus the one
non-negotiable rule inline, then a task→page map into this documentation. The
docs are the single source of truth; the skill routes the agent to them. That
means there is no second copy of the details to keep in sync — update a doc
page, and the skill still points at it.

## These docs are agent-readable

Every page here is also served as raw Markdown — append `.md` to any URL:

- Canonical skill: `https://result-rpc.com/skill.md`
- Page Markdown: `https://result-rpc.com/concepts/pagination.md`
- Index for LLMs: `https://result-rpc.com/llms.txt`
- Full corpus: `https://result-rpc.com/llms-full.txt`
- Agent surface manifest: `https://result-rpc.com/agent-readability.json`
- Hosted docs MCP: `https://result-rpc.com/.well-known/mcp.json`

So an agent with web access can read the whole documentation set directly,
whether or not the skill is installed. The skill just gives it the map and the
guardrails up front.

## Installing for Codex and compatible agents

The skill ships inside the npm package at
`node_modules/result-rpc/skills/result-rpc/SKILL.md`. Make it available to your
agent by linking it into the convention it reads. Codex and other Agents Skills
compatible tools use `.agents/skills`:

```bash
mkdir -p .agents/skills
ln -s ../../node_modules/result-rpc/skills/result-rpc .agents/skills/result-rpc
```

Claude Code uses `.claude/skills`:

```bash
mkdir -p .claude/skills
ln -s ../../node_modules/result-rpc/skills/result-rpc .claude/skills/result-rpc
```

A symlink keeps the skill current: when you upgrade `result-rpc`, the skill
upgrades with it. If your operating system or tool does not follow project
symlinks, use the matching explicit copy form:

```bash
mkdir -p .agents/skills
cp -R node_modules/result-rpc/skills/result-rpc .agents/skills/result-rpc

# Or, for Claude Code:
mkdir -p .claude/skills
cp -R node_modules/result-rpc/skills/result-rpc .claude/skills/result-rpc
```

The copy is a snapshot. Remove and recreate it after upgrading the package.
Verify either installation without depending on agent-specific UI:

```bash
test -f .agents/skills/result-rpc/SKILL.md || \
  test -f .claude/skills/result-rpc/SKILL.md
```

Once linked, an agent working in your repo discovers the skill by its
description and pulls in the client-boundary rule and the page map before it
writes contract, client, or handler code.

## What the skill enforces

The skill front-loads the rules that are easy to get wrong and expensive to get
wrong:

- **Build the browser client from a `contract()`, never the router** — the
  [client boundary](/concepts/client-boundary/) rule, because a value import of
  server code ships handlers and secrets to the browser.
- **The Result runtime is [better-result](https://github.com/dmmulroy/better-result) 3.0**
  — a peer dependency, not vendored; the skill's foundation section orients the
  agent to the dialect (`gen` returns `ok(x)`) and the zero-copy adoption rule.
- Errors are declared, closed, and returned — not thrown.
- The contract is the error registry; shells index by tag and claim exact definitions.
- Mutations declare their blast radius in the contract.

Everything else it defers to the page map, fetched as Markdown on demand.

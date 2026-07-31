import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const docs = resolve(root, "website/dist/client");
const requiredArtifacts = [
  ".well-known/mcp.json",
  ".well-known/mcp/server-card.json",
  "agent-readability.json",
  "llms-full.txt",
  "llms.txt",
  "skill.md",
];

for (const relative of requiredArtifacts) {
  if (!(await stat(resolve(docs, relative))).isFile()) {
    throw new Error(`Missing built agent artifact: ${relative}`);
  }
}

const canonicalSkill = await readFile(resolve(root, "skills/result-rpc/SKILL.md"), "utf8");
const builtSkill = await readFile(resolve(docs, "skill.md"), "utf8");
if (canonicalSkill !== builtSkill) throw new Error("Built skill differs from packaged skill");

const routePattern = /https:\/\/result-rpc\.com(?<route>\/[a-z0-9/-]+\.md)/giu;
const relativeRoutePattern = /`(?<route>\/(?:concepts|guides|reference|start)\/[a-z0-9/-]+)`/giu;
const agentDocuments = [canonicalSkill, await readFile(resolve(docs, "llms.txt"), "utf8")];
const routes = new Set(
  agentDocuments.flatMap((document) => [
    ...[...document.matchAll(routePattern)].map((match) => match.groups.route),
    ...[...document.matchAll(relativeRoutePattern)].map((match) => `${match.groups.route}.md`),
  ]),
);
for (const route of routes) {
  if (!(await stat(resolve(docs, route.slice(1)))).isFile()) {
    throw new Error(`Agent instructions name a missing raw Markdown route: ${route}`);
  }
}

const readability = JSON.parse(await readFile(resolve(docs, "agent-readability.json"), "utf8"));
if (readability.artifacts.mcp?.url !== "https://result-rpc.com/mcp") {
  throw new Error("agent-readability.json does not advertise the hosted MCP server");
}

console.log(
  `agent docs smoke: ${requiredArtifacts.length} artifacts and ${routes.size} routes passed`,
);

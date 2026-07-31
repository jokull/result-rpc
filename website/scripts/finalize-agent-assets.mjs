import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const website = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(website, "..");
const output = resolve(website, "dist");
const assets = resolve(output, "client");

await mkdir(assets, { recursive: true });

for (const name of [
  "agent-readability.json",
  "llms-full.txt",
  "llms.txt",
  "robots.txt",
  "sitemap.xml",
]) {
  await copyFile(resolve(output, name), resolve(assets, name));
}

const canonicalSkill = await readFile(resolve(repository, "skills/result-rpc/SKILL.md"), "utf8");
await copyFile(resolve(repository, "skills/result-rpc/SKILL.md"), resolve(assets, "skill.md"));
const builtSkill = await readFile(resolve(assets, "skill.md"), "utf8");
if (builtSkill !== canonicalSkill) {
  throw new Error("Built /skill.md differs from the packaged canonical skill");
}

const compact = await readFile(resolve(assets, "llms.txt"), "utf8");
for (const required of [
  "https://result-rpc.com/skill.md",
  "https://result-rpc.com/concepts/client-boundary",
  "https://result-rpc.com/concepts/results",
  "https://result-rpc.com/concepts/react",
  "https://result-rpc.com/concepts/wire",
]) {
  if (!compact.includes(required)) throw new Error(`llms.txt is missing ${required}`);
}

console.log("[result-rpc] verified and staged agent-facing artifacts");

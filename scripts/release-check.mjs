import { appendFile, readFile, readdir } from "node:fs/promises";
import process from "node:process";
import packageJson from "../package.json" with { type: "json" };
import { assertReleaseIsDocumented, releasePlan } from "./release-plan.mjs";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const outputs = releasePlan(packageJson, tag);

const changesetDir = new URL("../.changeset/", import.meta.url);
const pendingChangesets = (await readdir(changesetDir))
  .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
  .sort();
const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");

assertReleaseIsDocumented(outputs.version, changelog, pendingChangesets);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
}

console.log(`Release v${outputs.version} is valid; npm dist-tag will be ${outputs.dist_tag}.`);

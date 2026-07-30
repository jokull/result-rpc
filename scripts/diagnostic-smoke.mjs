import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root, "diagnostics/fixture.ts");
const source = readFileSync(fixture, "utf8");
const expected = source.split("\n").flatMap((line, index) => {
  const match = /\/\/ diagnostic: ([a-z0-9-]+)/.exec(line);
  return match ? [{ code: match[1], line: index + 1 }] : [];
});

if (expected.length === 0) throw new Error("Diagnostic fixture has no expectations");

const compiler = resolve(root, "node_modules/typescript/bin/tsc");
const result = spawnSync(
  process.execPath,
  [compiler, "-p", "diagnostics/tsconfig.json", "--pretty", "false"],
  {
    cwd: root,
    encoding: "utf8",
  },
);
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.status === 0) throw new Error("Diagnostic fixture unexpectedly compiled without errors");
for (const expectation of expected) {
  if (!output.includes(expectation.code)) {
    throw new Error(`Missing named diagnostic ${expectation.code}:\n${output}`);
  }
  if (!output.includes(`diagnostics/fixture.ts(${expectation.line},`)) {
    throw new Error(
      `Diagnostic ${expectation.code} did not point at fixture line ${expectation.line}:\n${output}`,
    );
  }
}

console.log(`diagnostic smoke: ${expected.length} named constraints point at their call sites`);

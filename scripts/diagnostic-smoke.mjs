import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root, "diagnostics/fixture.ts");
const source = readFileSync(fixture, "utf8");
const expected = source.split("\n").flatMap((line, index) => {
  const code = /\/\/ diagnostic: ([a-z0-9-]+)/.exec(line)?.[1];
  const text = /\/\/ diagnostic-text: (.+)$/.exec(line)?.[1];
  return code || text ? [{ expected: code ?? text, line: index + 1 }] : [];
});

if (expected.length === 0) throw new Error("Diagnostic fixture has no expectations");

const compilers = [
  ["5.4", resolve(root, "node_modules/typescript-5-4/bin/tsc")],
  ["5.9", resolve(root, "node_modules/typescript-5-9/bin/tsc")],
  ["7.0", resolve(root, "node_modules/typescript/bin/tsc")],
];

for (const [version, compiler] of compilers) {
  const result = spawnSync(
    process.execPath,
    [compiler, "-p", "diagnostics/tsconfig.json", "--pretty", "false"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    throw new Error(
      `TypeScript ${version}: diagnostic fixture unexpectedly compiled without errors`,
    );
  }
  for (const expectation of expected) {
    if (!output.includes(expectation.expected)) {
      throw new Error(
        `TypeScript ${version}: missing diagnostic ${expectation.expected}:\n${output}`,
      );
    }
    if (!output.includes(`diagnostics/fixture.ts(${expectation.line},`)) {
      throw new Error(
        `TypeScript ${version}: diagnostic ${expectation.expected} did not point at fixture line ${expectation.line}:\n${output}`,
      );
    }
  }
}

console.log(
  `diagnostic smoke: ${expected.length} constraints point at their call sites on TypeScript 5.4, 5.9, and 7.0`,
);

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The strict project holds most diagnostics; the non-strict one exists because
 * a consumer without `strictNullChecks` is a config the library still has to
 * behave in, and `$satisfies` used to fail there in a way no strict run could
 * see — its message printer recursed until the compiler emitted TS2589.
 */
const projects = [
  ["strict", "diagnostics/tsconfig.json", "diagnostics/fixture.ts"],
  ["non-strict", "diagnostics/tsconfig.nonstrict.json", "diagnostics/fixture-nonstrict.ts"],
];

const compilers = [
  ["5.4", resolve(root, "node_modules/typescript-5-4/bin/tsc")],
  ["5.9", resolve(root, "node_modules/typescript-5-9/bin/tsc")],
  ["7.0", resolve(root, "node_modules/typescript/bin/tsc")],
];

let total = 0;

for (const [mode, project, fixture] of projects) {
  const source = readFileSync(resolve(root, fixture), "utf8");
  const expected = source.split("\n").flatMap((line, index) => {
    const code = /\/\/ diagnostic: ([a-z0-9-]+)/.exec(line)?.[1];
    const text = /\/\/ diagnostic-text: (.+)$/.exec(line)?.[1];
    return code || text ? [{ expected: code ?? text, line: index + 1 }] : [];
  });

  if (expected.length === 0) throw new Error(`${fixture} has no expectations`);
  total += expected.length;

  for (const [version, compiler] of compilers) {
    const result = spawnSync(process.execPath, [compiler, "-p", project, "--pretty", "false"], {
      cwd: root,
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const label = `TypeScript ${version} (${mode})`;

    if (result.status === 0) {
      throw new Error(`${label}: diagnostic fixture unexpectedly compiled without errors`);
    }
    // The failure this fixture was added for: the printer recursing until the
    // compiler abandons the type. It reports an error either way, so only the
    // code distinguishes a working diagnostic from an exhausted one.
    if (output.includes("TS2589")) {
      throw new Error(`${label}: type instantiation went too deep (TS2589):\n${output}`);
    }
    for (const expectation of expected) {
      if (!output.includes(expectation.expected)) {
        throw new Error(`${label}: missing diagnostic ${expectation.expected}:\n${output}`);
      }
      if (!output.includes(`${basename(fixture)}(${expectation.line},`)) {
        throw new Error(
          `${label}: diagnostic ${expectation.expected} did not point at ${fixture} line ${expectation.line}:\n${output}`,
        );
      }
    }
  }
}

console.log(
  `diagnostic smoke: ${total} constraints point at their call sites on TypeScript 5.4, 5.9, and 7.0, strict and non-strict`,
);

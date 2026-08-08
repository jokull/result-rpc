import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const tsc = fileURLToPath(new URL("./node_modules/typescript/bin/tsc", import.meta.url));

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "server/index": "src/server/index.ts",
    "client/index": "src/client/index.ts",
    "query/runtime": "src/query/runtime.ts",
    "react/index": "src/react/index.tsx",
    "testing/index": "src/testing/index.ts",
  },
  root: "src",
  outDir: "dist",
  format: "esm",
  platform: "neutral",
  target: "es2022",
  unbundle: true,
  clean: true,
  sourcemap: true,
  tsconfig: "tsconfig.build.json",
  dts: false,
  hooks: {
    "build:before": () => {
      // TypeScript 7's native compiler has no stable compiler API yet, so let
      // tsc emit declarations before tsdown validates the completed package.
      execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json", "--emitDeclarationOnly"], {
        stdio: "inherit",
      });
    },
  },
  deps: {
    neverBundle: true,
    onlyImport: ["@tanstack/query-core", "better-result", "devalue", "react"],
  },
  publint: {
    strict: true,
  },
  attw: {
    profile: "esm-only",
    level: "error",
  },
  failOnWarn: true,
});

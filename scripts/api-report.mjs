import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const update = process.argv.includes("--update");
const reports = [
  ["index", "result-rpc.api.md"],
  ["server/index", "result-rpc.server.api.md"],
  ["client/index", "result-rpc.client.api.md"],
  ["db", "result-rpc.db.api.md"],
  ["query/runtime", "result-rpc.query.api.md"],
  ["react/index", "result-rpc.react.api.md"],
  ["testing/index", "result-rpc.testing.api.md"],
];

mkdirSync(resolve(root, "etc"), { recursive: true });

for (const [entry, reportFileName] of reports) {
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: root,
      mainEntryPointFilePath: `<projectFolder>/dist/${entry}.d.ts`,
      apiReport: {
        enabled: true,
        reportFileName,
        reportFolder: "<projectFolder>/etc",
        reportTempFolder: "<projectFolder>/temp/api",
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      compiler: { tsconfigFilePath: "<projectFolder>/tsconfig.build.json" },
      messages: {
        compilerMessageReporting: { default: { logLevel: "error" } },
        extractorMessageReporting: {
          default: { logLevel: "error" },
          "ae-missing-release-tag": { logLevel: "none" },
          "ae-undocumented": { logLevel: "none" },
          "ae-unresolved-link": { logLevel: "none" },
        },
        tsdocMessageReporting: { default: { logLevel: "none" } },
      },
    },
    configObjectFullPath: resolve(root, "api-extractor.generated.json"),
    packageJsonFullPath: resolve(root, "package.json"),
  });
  const result = Extractor.invoke(config, {
    localBuild: update,
    showDiagnostics: false,
    showVerboseMessages: false,
  });
  if (!result.succeeded) {
    throw new Error(
      `API report failed for ${entry}: ${result.errorCount} errors, ${result.warningCount} warnings`,
    );
  }
}

/**
 * Type-performance guard. Generates a synthetic consumer of N procedures,
 * measures what a consumer's compiler pays, and fails on regression against
 * the committed baseline. Run: `pnpm bench:types` (add `--update` to rebaseline).
 *
 * What it pins is SHAPE, not absolute speed: cost per procedure must stay
 * roughly constant. Superlinear growth here is the failure mode that makes a
 * typed-RPC library unusable at scale (tRPC's ts7056 class), so it is the
 * thing worth a gate.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, ".work");
const baselinePath = join(here, "baseline.json");
const SIZES = [25, 50, 100];

const contractFixture = (n) => {
  let s = `import { rpc, wire, error, defineModel } from "../../src/index.js";
import { createBrowserClient } from "../../src/client/index.js";
import { fetchTransport } from "../../src/client/transport.js";
import type { RouterInputs, RouterOutputs } from "../../src/index.js";
const app = rpc.context<{ db: string }>();
const M = defineModel("m", { key: "id", shape: { id: wire.string, a: wire.string, b: wire.number } });
const V = M.pick("id", "a");
`;
  for (let i = 0; i < n; i++) {
    s += `
const E${i} = error({ tag: "e/t${i}", data: wire.object({ id: wire.string }), httpStatus: 404, retry: "never", visibility: "public" });
export const q${i} = app.procedure()
  .input(wire.object({ id: wire.string, n: wire.number, f: wire.optional(wire.boolean) }))
  .output(wire.object({ v: V, list: wire.array(V), extra: wire.string }))
  .errors({ E${i} })
  .query();
export const m${i} = app.procedure()
  .input(wire.object({ id: wire.string, name: wire.string }))
  .output(M.select({ id: true, a: true, count: wire.number }))
  .errors({ E${i} })
  .mutation();
`;
  }
  s += `\nexport const contract = app.contract({\n`;
  for (let i = 0; i < n; i++) s += `  g${i}: { q: q${i}, m: m${i} },\n`;
  s += `});\nexport const client = createBrowserClient({ contract, transport: fetchTransport({ url: "/rpc" }) });\n`;
  s += `export type Inputs = RouterInputs<typeof contract>;\nexport type Outputs = RouterOutputs<typeof contract>;\n`;
  for (let i = 0; i < n; i++) {
    s += `export const r${i} = await client.g${i}.q({ id: "1", n: 1 });
export const s${i} = r${i}.ok ? r${i}.value.v.a : r${i}.error._tag;\n`;
  }
  return s;
};

const shellFixture = (n) => {
  let s = `import { rpc, wire, error } from "../../src/index.js";
import { createBrowserClient } from "../../src/client/index.js";
import { fetchTransport } from "../../src/client/transport.js";
import { defineShell } from "../../src/react/index.js";
const app = rpc.context<{ db: string }>();
const Session = error({ tag: "shared/session", data: wire.object({ userId: wire.string }) });
const Offline = error({ tag: "shared/offline", data: wire.object({ retryAt: wire.number }) });
const Defect = error({ tag: "shared/defect", data: wire.object({ incidentId: wire.string }) });
const AppShell = defineShell({ name: "app", claims: { Offline } });
const DefectShell = defineShell({ name: "defect", from: AppShell, claims: { Defect } });
const SessionShell = defineShell({ name: "session", from: DefectShell, claims: { Session } });
`;
  for (let i = 0; i < n; i++) {
    s += `
const E${i} = error({ tag: "domain/e${i}", data: wire.object({ id: wire.string }) });
export const q${i} = app.procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .errors({ Session, Offline, Defect, E${i} })
  .query();
`;
  }
  s += `\nexport const contract = app.contract({\n`;
  for (let i = 0; i < n; i++) s += `  g${i}: { q: q${i} },\n`;
  s += `});\nexport const client = createBrowserClient({ contract, transport: fetchTransport({ url: "/rpc" }) });\n`;
  for (let i = 0; i < n; i++) {
    s += `declare const useQ${i}: typeof SessionShell.useQuery;
export type Failure${i} = Extract<ReturnType<typeof useQ${i}<typeof client.g${i}.q>>, { readonly state: "failure" }>["error"]["_tag"];
`;
  }
  return s;
};

const fixtures = {
  contract: contractFixture,
  shell: shellFixture,
};

const measure = (profile, n) => {
  const filename = `${profile}-${n}.ts`;
  writeFileSync(join(work, filename), fixtures[profile](n));
  writeFileSync(
    join(work, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          jsx: "react-jsx",
          skipLibCheck: true,
          allowImportingTsExtensions: true,
          types: [],
          lib: ["ES2022", "DOM"],
        },
        include: [filename],
      },
      null,
      2,
    ),
  );
  const out = execFileSync(
    "npx",
    ["tsc", "-p", join(work, "tsconfig.json"), "--extendedDiagnostics"],
    { encoding: "utf8", cwd: here },
  );
  const grab = (label) => Number(out.match(new RegExp(`^${label}:\\s+(\\d+)`, "m"))?.[1] ?? 0);
  return { types: grab("Types"), instantiations: grab("Instantiations") };
};

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const results = {};
for (const [profile] of Object.entries(fixtures)) {
  const measurements = {};
  for (const n of SIZES) measurements[n] = measure(profile, n);
  const marginal = Math.round(
    (measurements[SIZES.at(-1)].instantiations - measurements[SIZES[0]].instantiations) /
      (SIZES.at(-1) - SIZES[0]),
  );
  results[profile] = { ...measurements, marginalInstantiationsPerUnit: marginal };
}
rmSync(work, { recursive: true, force: true });

// Marginal cost between the smallest and largest run is the number that must
// stay flat. A contract unit contains one query/mutation pair; a shell unit is
// one query error union narrowed through a three-shell chain.
console.log(JSON.stringify(results, null, 2));

if (process.argv.includes("--update")) {
  writeFileSync(baselinePath, JSON.stringify(results, null, 2) + "\n");
  console.log("baseline updated");
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch {
  console.log("no baseline yet — run with --update");
  process.exit(0);
}

for (const [profile, measurement] of Object.entries(results)) {
  const expected = baseline[profile]?.marginalInstantiationsPerUnit;
  if (typeof expected !== "number") {
    console.error(`no ${profile} baseline yet — run with --update`);
    process.exitCode = 1;
    continue;
  }
  const actual = measurement.marginalInstantiationsPerUnit;
  const drift = (actual - expected) / expected;
  console.log(
    `${profile} marginal/unit: ${actual} (baseline ${expected}, ${(drift * 100).toFixed(1)}%)`,
  );
  if (drift > 0.15) {
    console.error(`REGRESSION: ${profile} type cost grew more than 15%`);
    process.exitCode = 1;
  }
}

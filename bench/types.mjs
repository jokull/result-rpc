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

const fixture = (n) => {
  let s = `import { rpc, wire, ok, error, defineModel } from "../../src/index.js";
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
  .query(({ input }) => ok({ v: { id: input.id, a: "x" }, list: [], extra: "e" }));
export const m${i} = app.procedure()
  .input(wire.object({ id: wire.string, name: wire.string }))
  .output(M.select({ id: true, a: true, count: wire.number }))
  .errors({ E${i} })
  .mutation(({ input }) => ok({ id: input.id, a: input.name, count: 1 }));
`;
  }
  s += `\nexport const router = app.router({\n`;
  for (let i = 0; i < n; i++) s += `  g${i}: { q: q${i}, m: m${i} },\n`;
  s += `});\nexport const client = createBrowserClient({ router, transport: fetchTransport({ url: "/rpc" }) });\n`;
  s += `export type Inputs = RouterInputs<typeof router>;\nexport type Outputs = RouterOutputs<typeof router>;\n`;
  for (let i = 0; i < n; i++) {
    s += `export const r${i} = await client.g${i}.q({ id: "1", n: 1 });
export const s${i} = r${i}.ok ? r${i}.value.v.a : r${i}.error._tag;\n`;
  }
  return s;
};

const measure = (n) => {
  writeFileSync(join(work, `f${n}.ts`), fixture(n));
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
          skipLibCheck: true,
          allowImportingTsExtensions: true,
          types: [],
          lib: ["ES2022", "DOM"],
        },
        include: [`f${n}.ts`],
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
for (const n of SIZES) results[n] = measure(n);
rmSync(work, { recursive: true, force: true });

// Marginal cost per procedure between the smallest and largest run: the
// number that must stay flat.
const per = (a, b) => Math.round((results[b].instantiations - results[a].instantiations) / (b - a));
const marginal = per(SIZES[0], SIZES.at(-1));
const report = { ...results, marginalInstantiationsPerProcedure: marginal };
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes("--update")) {
  writeFileSync(baselinePath, JSON.stringify(report, null, 2) + "\n");
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

const drift =
  (marginal - baseline.marginalInstantiationsPerProcedure) /
  baseline.marginalInstantiationsPerProcedure;
console.log(
  `marginal/procedure: ${marginal} (baseline ${baseline.marginalInstantiationsPerProcedure}, ${(drift * 100).toFixed(1)}%)`,
);
if (drift > 0.15) {
  console.error("REGRESSION: per-procedure type cost grew more than 15%");
  process.exit(1);
}

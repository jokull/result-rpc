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
const LAYER_DEPTHS = [1, 3, 6, 10];
const MIDDLEWARE_DEPTHS = [1, 3, 6, 10, 15];

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
export const s${i} = r${i}.status === "ok" ? r${i}.value.v.a : r${i}.error._tag;\n`;
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

const layerFixture = (depth) => {
  let s = `import { rpc, wire, error, defineLayer } from "../../src/index.js";
import { createBrowserClient } from "../../src/client/index.js";
import { fetchTransport } from "../../src/client/transport.js";
import { defineShell, layerShell } from "../../src/react/index.js";
import type { ClaimedBy, ValueOf } from "../../src/react/index.js";
const app = rpc.context<{ db: string }>();
const Boundary = error({ tag: "boundary/offline", data: wire.object({}) });
const Root = defineShell({ name: "root", claims: { Boundary } });
`;
  for (let i = 0; i < depth; i++) {
    s += `
const E${i} = error({ tag: "layer/e${i}", data: wire.object({ depth: wire.number }) });
const L${i} = defineLayer({
  name: "layer-${i}",
  key: "value${i}",
  provides: wire.object({ id: wire.string, depth: wire.number }),
  errors: { E${i} },
});
const P${i} = L${i}.contract(app);
`;
  }
  s += `
const contract = app.contract({
`;
  for (let i = 0; i < depth; i++) s += `  p${i}: P${i},\n`;
  s += `});
const client = createBrowserClient({ contract, transport: fetchTransport({ url: "/rpc" }) });
`;
  for (let i = 0; i < depth; i++) {
    s += `const S${i} = layerShell(L${i}, { from: ${i === 0 ? "Root" : `S${i - 1}`}, procedure: client.p${i} });\n`;
  }
  s += `export type FinalClaims = ClaimedBy<typeof S${depth - 1}>;
export type FinalValue = ValueOf<typeof S${depth - 1}>;
export const resolveFinal = S${depth - 1}.resolveProcedure(client);
`;
  return s;
};

const middlewareFixture = (depth, diamond) => {
  let s = `import { wire, error, ok } from "../../src/index.js";
import { serverRpc } from "../../src/server/index.js";
import type { MiddlewareTypesOf } from "../../src/index.js";
const app = serverRpc.context<{ root: string }>();
`;
  let previous = undefined;
  for (let i = 0; i < depth; i++) {
    for (const branch of diamond ? ["a", "b", "join"] : ["chain"]) {
      const name = `E_${branch}_${i}`;
      s += `const ${name} = error({ tag: "middleware/${branch}-${i}", data: wire.object({}) });\n`;
    }
    const after = previous === undefined ? "" : `.after(${previous})`;
    if (diamond) {
      s += `const A${i} = app.middleware<{ readonly a${i}: true }>().errors({ E_a_${i} })${after}.use(({ next }) => next({ context: { a${i}: true as const } }));
const B${i} = app.middleware<{ readonly b${i}: true }>().errors({ E_b_${i} })${after}.use(({ next }) => next({ context: { b${i}: true as const } }));
const J${i} = app.middleware<{ readonly j${i}: true }>().errors({ E_join_${i} }).after(A${i}).after(B${i}).use(({ next }) => next({ context: { j${i}: true as const } }));
`;
      previous = `J${i}`;
    } else {
      s += `const M${i} = app.middleware<{ readonly v${i}: true }>().errors({ E_chain_${i} })${after}.use(({ next }) => next({ context: { v${i}: true as const } }));
`;
      previous = `M${i}`;
    }
  }
  s += `export type FinalMiddleware = MiddlewareTypesOf<typeof ${previous}>;
export type FinalContext = FinalMiddleware["outputContext"];
export type FinalErrors = FinalMiddleware["definitionSources"];
export const proof = (context: FinalContext): string => context.root;
void ok;
`;
  return s;
};

const middlewareDiamondContextFixture = (depth) => {
  let s = `import { serverRpc } from "../../src/server/index.js";
import type { MiddlewareTypesOf } from "../../src/index.js";
const app = serverRpc.context<{ root: string }>();
`;
  let previous = undefined;
  for (let i = 0; i < depth; i++) {
    const after = previous === undefined ? "" : `.after(${previous})`;
    s += `const A${i} = app.middleware<{ readonly a${i}: true }>()${after}.use(({ next }) => next({ context: { a${i}: true as const } }));
const B${i} = app.middleware<{ readonly b${i}: true }>()${after}.use(({ next }) => next({ context: { b${i}: true as const } }));
const J${i} = app.middleware<{ readonly j${i}: true }>().after(A${i}).after(B${i}).use(({ next }) => next({ context: { j${i}: true as const } }));
`;
    previous = `J${i}`;
  }
  return `\n${s}export type Final = MiddlewareTypesOf<typeof ${previous}>["outputContext"];\n`;
};

const middlewareDiamondErrorsFixture = (depth) => {
  let s = `import { wire, error } from "../../src/index.js";
import { serverRpc } from "../../src/server/index.js";
import type { MiddlewareTypesOf } from "../../src/index.js";
const app = serverRpc.context<{ root: string }>();
`;
  let previous = undefined;
  for (let i = 0; i < depth; i++) {
    const after = previous === undefined ? "" : `.after(${previous})`;
    s += `const EA${i} = error({ tag: "middleware/ea-${i}" });
const EB${i} = error({ tag: "middleware/eb-${i}" });
const EJ${i} = error({ tag: "middleware/ej-${i}" });
const A${i} = app.middleware().errors({ EA${i} })${after}.use(({ next }) => next({ context: {} }));
const B${i} = app.middleware().errors({ EB${i} })${after}.use(({ next }) => next({ context: {} }));
const J${i} = app.middleware().errors({ EJ${i} }).after(A${i}).after(B${i}).use(({ next }) => next({ context: {} }));
`;
    previous = `J${i}`;
  }
  return `\n${s}export type Final = MiddlewareTypesOf<typeof ${previous}>["definitionSources"];\nvoid wire;\n`;
};

const clientFixture = (n) => {
  let s = `import { rpc, wire, error } from "../../src/index.js";
import { createBrowserClient, type ClientProcedureInput, type ClientProcedureOutput } from "../../src/client/index.js";
import { fetchTransport } from "../../src/client/transport.js";
const app = rpc.context<{}>();
const Shared = error({ tag: "client/shared" });
`;
  for (let i = 0; i < n; i++) {
    s += `const Q${i} = app.procedure().input(wire.object({ id: wire.string, n: wire.number })).output(wire.object({ value: wire.string, n: wire.number })).errors({ Shared }).query();\n`;
  }
  s += "const contract = app.contract({\n";
  for (let i = 0; i < n; i++) s += `  q${i}: Q${i},\n`;
  s += `});
const client = createBrowserClient({ contract, transport: fetchTransport({ url: "/rpc" }) });
`;
  for (let i = 0; i < n; i++) {
    s += `export type I${i} = ClientProcedureInput<typeof client.q${i}>;
export type O${i} = ClientProcedureOutput<typeof client.q${i}>;
export const C${i} = client.q${i}({ id: "x", n: ${i} });
`;
  }
  return s;
};

const routerDepthFixture = (depth) => {
  let s = `import { rpc, wire } from "../../src/index.js";
import type { RouterInputs, RouterOutputs } from "../../src/index.js";
const app = rpc.context<{ requestId: string }>();
const leaf = app.procedure().input(wire.object({ id: wire.string })).output(wire.string).query();
`;
  let record = "{ leaf }";
  for (let i = 0; i < depth; i++) {
    s += `const R${i} = { branch${i}: ${record} } as const;\n`;
    record = `R${i}`;
  }
  s += `const contract = app.contract(${record});
export type Inputs = RouterInputs<typeof contract>;
export type Outputs = RouterOutputs<typeof contract>;
`;
  return s;
};

const modelSelectionFixture = (n) => {
  let s = `import { defineModel, wire, type InputOf, type ModelValue, type ModelProjection } from "../../src/index.js";
const Model = defineModel("wide", { key: "id", shape: { id: wire.string,\n`;
  for (let i = 0; i < n; i++) s += `  f${i}: wire.string,\n`;
  s += `} });
const Selected = Model.select({ id: true,\n`;
  for (let i = 0; i < n; i++) s += `  f${i}: true,\n`;
  s += `});
export type Full = ModelValue<typeof Model>;
export type Selection = InputOf<typeof Selected>;
export type Projection = ModelProjection<typeof Model>;
`;
  return s;
};

const fixtures = {
  contract: contractFixture,
  shell: shellFixture,
  layer: layerFixture,
  client: clientFixture,
  routerDepth: routerDepthFixture,
  modelSelection: modelSelectionFixture,
  middlewareChain: (depth) => middlewareFixture(depth, false),
  middlewareDiamond: (depth) => middlewareFixture(depth, true),
  middlewareDiamondContext: middlewareDiamondContextFixture,
  middlewareDiamondErrors: middlewareDiamondErrorsFixture,
};

const requestedProfile = process.env.RESULT_RPC_TYPE_PROFILE;
if (requestedProfile !== undefined && !(requestedProfile in fixtures)) {
  throw new TypeError(`Unknown type benchmark profile: ${requestedProfile}`);
}
const selectedFixtures = requestedProfile
  ? { [requestedProfile]: fixtures[requestedProfile] }
  : fixtures;

const sizesFor = (profile) =>
  profile === "layer"
    ? LAYER_DEPTHS
    : profile.startsWith("middleware") || profile === "routerDepth"
      ? MIDDLEWARE_DEPTHS
      : SIZES;

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
    "pnpm",
    ["exec", "tsc", "-p", join(work, "tsconfig.json"), "--extendedDiagnostics"],
    { encoding: "utf8", cwd: here },
  );
  const grab = (label) => Number(out.match(new RegExp(`^${label}:\\s+(\\d+)`, "m"))?.[1] ?? 0);
  return { types: grab("Types"), instantiations: grab("Instantiations") };
};

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const results = {};
for (const [profile] of Object.entries(selectedFixtures)) {
  const sizes = sizesFor(profile);
  const measurements = {};
  for (const n of sizes) measurements[n] = measure(profile, n);
  const marginal = Math.round(
    (measurements[sizes.at(-1)].instantiations - measurements[sizes[0]].instantiations) /
      (sizes.at(-1) - sizes[0]),
  );
  const lastSize = sizes.at(-1);
  const previousSize = sizes.at(-2);
  const terminalSlope = Math.round(
    (measurements[lastSize].instantiations - measurements[previousSize].instantiations) /
      (lastSize - previousSize),
  );
  results[profile] = {
    ...measurements,
    marginalInstantiationsPerUnit: marginal,
    terminalInstantiationsPerUnit: terminalSlope,
    terminalSlopeRatio: Number((terminalSlope / marginal).toFixed(3)),
  };
}
rmSync(work, { recursive: true, force: true });

// Marginal cost between the smallest and largest run is the number that must
// stay flat. A contract unit contains one query/mutation pair; a shell unit is
// one query error union narrowed through a three-shell chain.
console.log(JSON.stringify(results, null, 2));

if (process.argv.includes("--update")) {
  let nextBaseline = results;
  if (requestedProfile !== undefined) {
    let currentBaseline = {};
    try {
      currentBaseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    } catch {
      // A selected first run creates a partial baseline intentionally; later
      // full runs fill it in.
    }
    nextBaseline = { ...currentBaseline, ...results };
  }
  writeFileSync(baselinePath, JSON.stringify(nextBaseline, null, 2) + "\n");
  console.log(requestedProfile ? `${requestedProfile} baseline updated` : "baseline updated");
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
  if (measurement.terminalSlopeRatio > 1.4) {
    console.error(
      `REGRESSION: ${profile} terminal type cost is accelerating (${measurement.terminalSlopeRatio}x mean slope)`,
    );
    process.exitCode = 1;
  }
}

import { execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createTcpServer } from "node:net";
import { once } from "node:events";
import { build } from "vite";

/**
 * Installs a consumer fixture. `--offline` keeps repeat local runs fast and
 * hermetic against a warm store, but a cold store — a fresh CI runner, a fresh
 * clone — has none of the fixtures' transitive deps, and pnpm hard-fails with
 * ERR_PNPM_NO_OFFLINE_TARBALL rather than reaching for the network. Fall back
 * so the smoke test is a real check everywhere instead of only where someone
 * has already run it.
 */
const installFixture = (cwd) => {
  try {
    execFileSync("pnpm", ["install", "--offline", "--ignore-scripts"], { cwd, stdio: "inherit" });
  } catch {
    console.log("package smoke: store is cold, installing from the registry");
    execFileSync("pnpm", ["install", "--ignore-scripts"], { cwd, stdio: "inherit" });
  }
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "result-rpc-package-smoke-"));
const fixture = join(temporary, "consumer");
const nextFixture = join(temporary, "next-consumer");
const packDirectory = join(temporary, "pack");
const canary = "RESULT_RPC_SERVER_GRAPH_MUST_NOT_SHIP";
// Identifiers, not declaration forms. `"const executeProcedure ="` matched
// nothing for as long as it existed — the symbol is emitted as
// `async function executeProcedure` — so a quarter of the boundary check was
// silently vacuous. Matching the name survives a refactor changing how it is
// declared, and `assertMarkersAreLive` fails loudly if one ever stops matching.
// Identifiers, not declaration forms: `"const executeProcedure ="` matched
// nothing for as long as it existed — the symbol is emitted as
// `async function executeProcedure` — so a quarter of the boundary check was
// silently vacuous.
//
// Each name must also be distinctive enough to mean *our* server runtime.
// `createRouter` was tried and is not: Next ships its own
// (`next/dist/client/router.js`), so it fired on a clean Next browser bundle.
// `assertMarkersAreLive` catches a marker that stops matching; nothing catches
// one that matches too much except choosing names nobody else uses.
const serverRuntimeMarkers = [
  "ProcedureImplementer",
  "MiddlewareBuilder",
  "executeProcedure",
  "executeSubscription",
];

/**
 * A canary that no longer matches anything is a check that stopped checking
 * without telling anyone. Assert the markers are present where they are
 * supposed to be before relying on their absence anywhere else.
 */
const assertMarkersAreLive = (serverDirectory) => {
  const contents = contentsBelow(serverDirectory);
  for (const marker of serverRuntimeMarkers) {
    assert(
      contents.includes(marker),
      `server runtime marker no longer appears in the server build: ${marker}`,
    );
  }
};

const write = (path, contents) => {
  const target = join(fixture, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
};

const writeNext = (path, contents) => {
  const target = join(nextFixture, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
};

const rewritePublicTypeImports = (source) => {
  const replacements = new Map([
    ['"../src/index.js"', '"result-rpc"'],
    ['"../src/contract.js"', '"result-rpc"'],
    ['"../src/model.js"', '"result-rpc"'],
    ['"../src/wire.js"', '"result-rpc"'],
    ['"../src/client/index.js"', '"result-rpc/client"'],
    ['"../src/server/index.js"', '"result-rpc/server"'],
    ['"../src/server/contract.js"', '"result-rpc/server"'],
    ['"../src/query/runtime.js"', '"result-rpc/query"'],
    ['"../src/react/index.js"', '"result-rpc/react"'],
  ]);
  let rewritten = source;
  for (const [from, to] of replacements) rewritten = rewritten.replaceAll(from, to);
  return rewritten;
};

const filesBelow = (directory) => {
  if (!statSync(directory, { throwIfNoEntry: false })) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
};

const contentsBelow = (directory) =>
  filesBelow(directory)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertCleanBrowserOutput = (label, directory) => {
  const contents = contentsBelow(directory);
  assert(!contents.includes(canary), `${label} contains the planted server canary`);
  assert(!contents.includes("server-driver.ts"), `${label} contains the server-only module`);
  for (const marker of serverRuntimeMarkers) {
    assert(!contents.includes(marker), `${label} contains server runtime marker: ${marker}`);
  }
};

const normalizeBuildResult = (result) => (Array.isArray(result) ? result : [result]);

const buildModules = (result) =>
  normalizeBuildResult(result).flatMap((buildResult) =>
    buildResult.output.flatMap((output) =>
      output.type === "chunk" ? Object.keys(output.modules) : [],
    ),
  );

const availablePort = () =>
  new Promise((resolvePort, reject) => {
    const server = createTcpServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object", "Could not reserve a Vite dev port");
      server.close((cause) => (cause ? reject(cause) : resolvePort(address.port)));
    });
  });

const waitForHttp = async (url, child, output) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Development server exited before serving ${url}:\n${output.join("")}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response;
    } catch {
      // The TCP listener is not ready yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Development server did not serve ${url} within 30 seconds:\n${output.join("")}`);
};

const stopChild = async (child) => {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Development server did not stop after SIGTERM")), 5_000),
    ),
  ]);
};

const runReactLifecycleSmoke = (tarball, reactVersion) => {
  const runtimeFixture = join(temporary, `react-${reactVersion}`);
  mkdirSync(runtimeFixture, { recursive: true });
  writeFileSync(
    join(runtimeFixture, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          react: reactVersion,
          "react-test-renderer": reactVersion,
          "result-rpc": `file:${tarball}`,
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(runtimeFixture, "probe.mjs"),
    readFileSync(join(root, "scripts/fixtures/react-claim-lifecycle.mjs"), "utf8"),
  );
  execFileSync("pnpm", ["install", "--ignore-scripts"], {
    cwd: runtimeFixture,
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["probe.mjs"], { cwd: runtimeFixture, stdio: "inherit" });
};

try {
  mkdirSync(packDirectory, { recursive: true });
  const packOutput = execFileSync(
    "npm",
    ["pack", "--silent", "--pack-destination", packDirectory],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  ).trim();
  const packedFilename = packOutput.split(/\r?\n/).at(-1);
  assert(packedFilename?.endsWith(".tgz"), `npm pack did not report a tarball:\n${packOutput}`);
  const tarball = join(packDirectory, packedFilename);

  write(
    "package.json",
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@types/react": "19.2.17",
          react: "19.2.8",
          "result-rpc": `file:${tarball}`,
        },
      },
      null,
      2,
    ),
  );
  write(
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          types: [],
          skipLibCheck: false,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  write(
    "index.html",
    '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/good.ts"></script></body></html>\n',
  );
  write(
    "src/contract.ts",
    `import { rpc, wire } from "result-rpc";
import type { AppContext } from "./server";

const app = rpc.context<AppContext>();
export const pingContract = app
  .procedure()
  .input(wire.object({ value: wire.string }))
  .output(wire.string)
  .query();
export const appContract = app.contract({ ping: pingContract });
export { app };
`,
  );
  write(
    "src/server-driver.ts",
    `export const SERVER_DRIVER_MARKER = ${JSON.stringify(canary)};
`,
  );
  write(
    "src/server.ts",
    `import { ok } from "result-rpc";
import { serverRpc } from "result-rpc/server";
import { pingContract } from "./contract";
import { SERVER_DRIVER_MARKER } from "./server-driver";

export interface AppContext {
  readonly secret: string;
}

const server = serverRpc.context<AppContext>();
const ping = server.implement(pingContract).handler(({ input }) =>
  ok(input.value === SERVER_DRIVER_MARKER ? SERVER_DRIVER_MARKER : input.value),
);
export const router = server.router({ ping });
`,
  );
  write(
    "src/good.ts",
    `import { createBrowserClient, fetchTransport } from "result-rpc/client";
import { appContract } from "./contract";

const client = createBrowserClient({
  contract: appContract,
  transport: fetchTransport({ url: "/rpc" }),
});
document.querySelector("#app")!.textContent = client.ping.$kind;
`,
  );
  write(
    "src/worker.ts",
    `import { createFetchHandler } from "result-rpc/server";
import { router } from "./server";

const handle = createFetchHandler({
  router,
  createContext: () => ({ secret: "worker" }),
});

export default { fetch: handle };
`,
  );
  write(
    "src/public-api.test-d.ts",
    rewritePublicTypeImports(readFileSync(join(root, "tests/public-api.test-d.ts"), "utf8")),
  );
  write(
    "src/model.test-d.ts",
    rewritePublicTypeImports(readFileSync(join(root, "tests/model.test-d.ts"), "utf8")),
  );
  write(
    "src/subpaths.test-d.ts",
    `import type * as Root from "result-rpc";
import type * as Server from "result-rpc/server";
import type * as Client from "result-rpc/client";
import type * as Db from "result-rpc/db";
import type * as Query from "result-rpc/query";
import type * as ReactEntry from "result-rpc/react";
import type * as Testing from "result-rpc/testing";

export type EveryPublicSubpath = readonly [
  keyof typeof Root,
  keyof typeof Server,
  keyof typeof Client,
  keyof typeof Db,
  keyof typeof Query,
  keyof typeof ReactEntry,
  keyof typeof Testing,
];
`,
  );

  installFixture(fixture);

  const installedPackage = join(fixture, "node_modules/result-rpc");
  const manifest = JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8"));
  for (const [subpath, conditions] of Object.entries(manifest.exports)) {
    for (const condition of ["types", "import"]) {
      const target = join(installedPackage, conditions[condition]);
      assert(
        statSync(target, { throwIfNoEntry: false })?.isFile(),
        `Missing ${condition} target for export ${subpath}: ${conditions[condition]}`,
      );
    }
  }
  assert(
    !statSync(join(installedPackage, "src"), { throwIfNoEntry: false }),
    "Published package unexpectedly contains src/",
  );
  const declarationMaps = filesBelow(join(installedPackage, "dist")).filter((path) =>
    path.endsWith(".d.ts.map"),
  );
  assert(
    declarationMaps.length === 0,
    `Published package unexpectedly contains declaration maps without shipped sources:\n${declarationMaps
      .map((path) => relative(installedPackage, path))
      .join("\n")}`,
  );
  for (const mapPath of declarationMaps) {
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    for (const [index, source] of map.sources.entries()) {
      const embedded = map.sourcesContent?.[index];
      const resolvedSource = resolve(dirname(mapPath), source);
      assert(
        typeof embedded === "string" ||
          statSync(resolvedSource, { throwIfNoEntry: false })?.isFile(),
        `Declaration map points to unavailable source: ${relative(installedPackage, mapPath)} -> ${source}`,
      );
    }
  }
  const runtimeMaps = filesBelow(join(installedPackage, "dist")).filter((path) =>
    path.endsWith(".js.map"),
  );
  assert(runtimeMaps.length > 0, "Published package unexpectedly contains no runtime source maps");
  for (const mapPath of runtimeMaps) {
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    assert(
      Array.isArray(map.sources) &&
        Array.isArray(map.sourcesContent) &&
        map.sources.length === map.sourcesContent.length &&
        map.sourcesContent.every((source) => typeof source === "string"),
      `Runtime source map lacks embedded sources: ${relative(installedPackage, mapPath)}`,
    );
  }

  const supportedTypeScriptCompilers = [
    ["5.4", resolve(root, "node_modules/typescript-5-4/bin/tsc")],
    ["5.9", resolve(root, "node_modules/typescript-5-9/bin/tsc")],
    ["7.0", resolve(root, "node_modules/typescript/bin/tsc")],
  ];
  for (const [version, compiler] of supportedTypeScriptCompilers) {
    console.log(`package smoke: TypeScript ${version}`);
    execFileSync(process.execPath, [compiler, "-p", "tsconfig.json"], {
      cwd: fixture,
      stdio: "inherit",
    });
  }

  runReactLifecycleSmoke(tarball, "18.3.1");
  runReactLifecycleSmoke(tarball, "19.2.8");

  const devPort = await availablePort();
  const devOutput = [];
  const devServer = spawn(
    resolve(root, "node_modules/.bin/vite"),
    ["--host", "127.0.0.1", "--port", String(devPort), "--strictPort", "--force"],
    { cwd: fixture, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  devServer.stdout.on("data", (chunk) => devOutput.push(chunk.toString()));
  devServer.stderr.on("data", (chunk) => devOutput.push(chunk.toString()));
  try {
    const origin = `http://127.0.0.1:${devPort}`;
    const page = await waitForHttp(`${origin}/`, devServer, devOutput);
    const module = await waitForHttp(`${origin}/src/good.ts`, devServer, devOutput);
    const transformed = await module.text();
    assert(!transformed.includes(canary), "Vite dev transform contains the server canary");
    assert(
      (await page.text()).includes("/src/good.ts"),
      "Vite dev did not serve the fixture entry",
    );
  } finally {
    await stopChild(devServer);
  }
  // Prove the markers still match the shipped server build before trusting
  // their absence from any browser output below.
  assertMarkersAreLive(join(fixture, "node_modules/result-rpc/dist/server"));
  assertCleanBrowserOutput(
    "Vite 8 development dependency cache",
    join(fixture, "node_modules/.vite"),
  );

  const goodBuild = await build({
    root: fixture,
    configFile: false,
    logLevel: "error",
    build: {
      outDir: "dist-good",
      emptyOutDir: true,
      sourcemap: true,
      minify: false,
      rollupOptions: { input: resolve(fixture, "src/good.ts") },
    },
  });
  const goodModules = buildModules(goodBuild).map((path) => relative(fixture, path));
  assert(
    !goodModules.some((path) => path === "src/server.ts" || path === "src/server-driver.ts"),
    `Vite 8 production graph contains server modules:\n${goodModules.join("\n")}`,
  );
  assert(
    !goodModules.some(
      (path) =>
        path.includes("result-rpc/dist/server/http.js") ||
        path.includes("result-rpc/dist/server/contract.js"),
    ),
    "Vite 8 production graph contains result-rpc's server runtime",
  );
  assertCleanBrowserOutput("Vite 8 production output", join(fixture, "dist-good"));

  await build({
    root: fixture,
    configFile: false,
    logLevel: "error",
    ssr: { target: "webworker", noExternal: ["result-rpc"] },
    build: {
      ssr: resolve(fixture, "src/worker.ts"),
      outDir: "dist-worker",
      emptyOutDir: true,
      minify: false,
      target: "es2022",
    },
  });
  const workerOutput = contentsBelow(join(fixture, "dist-worker"));
  assert(workerOutput.includes(canary), "Worker graph did not contain its server canary");
  assert(!/from ["']node:/.test(workerOutput), "Worker graph contains a Node builtin import");

  writeNext(
    "package.json",
    JSON.stringify(
      {
        private: true,
        type: "module",
        scripts: { dev: "next dev", build: "next build" },
        dependencies: {
          next: "16.2.12",
          react: "19.2.8",
          "react-dom": "19.2.8",
          "result-rpc": `file:${tarball}`,
          "server-only": "0.0.1",
        },
        devDependencies: {
          "@types/node": "22.20.1",
          "@types/react": "19.2.17",
          "@types/react-dom": "19.2.3",
          typescript: "7.0.2",
        },
      },
      null,
      2,
    ),
  );
  writeNext(
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "preserve",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          plugins: [{ name: "next" }],
        },
        include: ["next-env.d.ts", ".next/types/**/*.ts", "**/*.ts", "**/*.tsx"],
        exclude: ["node_modules"],
      },
      null,
      2,
    ),
  );
  writeNext(
    "next-env.d.ts",
    '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
  );
  writeNext(
    "next.config.mjs",
    `export default {
  experimental: { useTypeScriptCli: true },
};
`,
  );
  writeNext(
    "src/contract.ts",
    `import { rpc, wire } from "result-rpc";

export interface AppContext {
  readonly requestId: string;
}

export const app = rpc.context<AppContext>();
export const pingContract = app
  .procedure()
  .input(wire.object({ value: wire.string }))
  .output(wire.string)
  .query();
export const appContract = app.contract({ ping: pingContract });
`,
  );
  writeNext(
    "src/server-canary.ts",
    `import "server-only";
export const SERVER_CANARY = ${JSON.stringify(canary)};
`,
  );
  writeNext(
    "src/server.ts",
    `import "server-only";
import { ok } from "result-rpc";
import { createServerClient, serverRpc } from "result-rpc/server";
import { pingContract, type AppContext } from "./contract";
import { SERVER_CANARY } from "./server-canary";

const server = serverRpc.context<AppContext>();
const ping = server.implement(pingContract).handler(({ input }) =>
  ok(input.value === SERVER_CANARY ? SERVER_CANARY : input.value),
);
const router = server.router({ ping });
export const serverClient = createServerClient(router, {
  context: { requestId: "package-smoke" },
});
`,
  );
  writeNext(
    "src/client.ts",
    `import { createBrowserClient, fetchTransport } from "result-rpc/client";
import { appContract } from "./contract";

export const client = createBrowserClient({
  contract: appContract,
  transport: fetchTransport({ url: "/rpc" }),
});
`,
  );
  writeNext(
    "src/carriers.ts",
    `import type {
  BrowserClientErrorOf,
  BrowserClientOf,
  BrowserProcedureClient,
  ClientPaginationTypes,
  ClientProcedureError,
  ClientProcedureInput,
  ClientProcedureKind,
  ClientProcedureOutput,
  ClientProcedurePagination,
  ClientProcedureSource,
  ClientProcedureTypes,
} from "result-rpc/client";
import type {
  MutationProcedureClientLike,
  PaginatedProcedureClientLike,
  ProcedureClientLike,
  QueryProcedureClientLike,
  SubscriptionProcedureClientLike,
} from "result-rpc/query";
import type { appContract, pingContract } from "./contract";
import type { client } from "./client";

type Ping = typeof client.ping;
export type CarrierAudit = readonly [
  ClientProcedureTypes<Ping>,
  ClientProcedureInput<Ping>,
  ClientProcedureOutput<Ping>,
  ClientProcedureError<Ping>,
  ClientProcedureKind<Ping>,
  ClientProcedureSource<Ping>,
  ClientProcedurePagination<Ping>,
  BrowserProcedureClient<typeof pingContract>,
  BrowserClientOf<typeof appContract>,
  BrowserClientErrorOf<typeof appContract>,
  ClientPaginationTypes<unknown, unknown, unknown>,
  ProcedureClientLike,
  QueryProcedureClientLike,
  MutationProcedureClientLike,
  PaginatedProcedureClientLike,
  SubscriptionProcedureClientLike,
];
`,
  );
  writeNext(
    "src/providers.tsx",
    `"use client";
import type { ReactNode } from "react";
import { ResultRpcProvider } from "result-rpc/react";
import { client } from "./client";

export const Providers = ({ children }: { children: ReactNode }) => (
  <ResultRpcProvider client={client}>{children}</ResultRpcProvider>
);
`,
  );
  writeNext(
    "src/client-view.tsx",
    `"use client";
import { useResultQuery } from "result-rpc/react";
import type { CarrierAudit } from "./carriers";
import { client } from "./client";

export const ClientView = () => {
  const state = useResultQuery(client.ping, { value: "browser" });
  const carrierAudit: CarrierAudit | undefined = undefined;
  return <p data-carriers={carrierAudit === undefined ? "checked" : "invalid"} data-query-state={state.state}>{state.state}</p>;
};
`,
  );
  writeNext(
    "app/layout.tsx",
    `import type { ReactNode } from "react";
import { Providers } from "../src/providers";

export default function Layout({ children }: { children: ReactNode }) {
  return <html><body><Providers>{children}</Providers></body></html>;
}
`,
  );
  writeNext(
    "app/page.tsx",
    `import { createQueryRuntime } from "result-rpc/query";
import { ResultRpcHydrationBoundary } from "result-rpc/react";
import { ClientView } from "../src/client-view";
import { serverClient } from "../src/server";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ skew?: string }>;
}) {
  const result = await serverClient.ping({ value: "rsc" });
  const runtime = createQueryRuntime({ client: serverClient });
  await runtime.prefetch(serverClient.ping, { value: "browser" });
  const state = runtime.dehydrate();
  const hydrationState = (await searchParams).skew === "1"
    ? { ...state, contract: "packed-stale-contract" }
    : state;
  return <ResultRpcHydrationBoundary state={hydrationState}><p>{result.ok ? result.value : result.error._tag}</p><ClientView /></ResultRpcHydrationBoundary>;
}
`,
  );

  installFixture(nextFixture);

  const nextBin = join(nextFixture, "node_modules/.bin/next");
  const nextDevPort = await availablePort();
  const nextDevOutput = [];
  const nextDevServer = spawn(
    nextBin,
    ["dev", "--hostname", "127.0.0.1", "--port", String(nextDevPort)],
    {
      cwd: nextFixture,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  nextDevServer.stdout.on("data", (chunk) => nextDevOutput.push(chunk.toString()));
  nextDevServer.stderr.on("data", (chunk) => nextDevOutput.push(chunk.toString()));
  try {
    const page = await waitForHttp(
      `http://127.0.0.1:${nextDevPort}/`,
      nextDevServer,
      nextDevOutput,
    );
    const pageHtml = await page.text();
    assert(pageHtml.includes("data-carriers"), "Next dev did not render the RSC fixture");
    assert(
      pageHtml.includes('data-query-state="success"'),
      "Next dev matching hydration did not reach first paint",
    );
    const skewPage = await waitForHttp(
      `http://127.0.0.1:${nextDevPort}/?skew=1`,
      nextDevServer,
      nextDevOutput,
    );
    assert(
      (await skewPage.text()).includes('data-query-state="pending"'),
      "Next dev mismatched hydration entered the client cache",
    );
  } finally {
    await stopChild(nextDevServer);
  }
  assertCleanBrowserOutput(
    "Next development browser output",
    join(nextFixture, ".next/dev/static"),
  );

  rmSync(join(nextFixture, ".next"), { recursive: true, force: true });
  execFileSync(nextBin, ["build"], {
    cwd: nextFixture,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" },
    stdio: "inherit",
  });
  assertCleanBrowserOutput("Next production browser output", join(nextFixture, ".next/static"));
  assert(
    contentsBelow(join(nextFixture, ".next/server")).includes(canary),
    "Next production server graph did not contain the planted server canary",
  );

  const nextProductionPort = await availablePort();
  const nextProductionOutput = [];
  const nextProductionServer = spawn(
    nextBin,
    ["start", "--hostname", "127.0.0.1", "--port", String(nextProductionPort)],
    {
      cwd: nextFixture,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  nextProductionServer.stdout.on("data", (chunk) => nextProductionOutput.push(chunk.toString()));
  nextProductionServer.stderr.on("data", (chunk) => nextProductionOutput.push(chunk.toString()));
  try {
    const matchingPage = await waitForHttp(
      `http://127.0.0.1:${nextProductionPort}/`,
      nextProductionServer,
      nextProductionOutput,
    );
    assert(
      (await matchingPage.text()).includes('data-query-state="success"'),
      "Next production matching hydration did not reach first paint",
    );
    const skewPage = await waitForHttp(
      `http://127.0.0.1:${nextProductionPort}/?skew=1`,
      nextProductionServer,
      nextProductionOutput,
    );
    assert(
      (await skewPage.text()).includes('data-query-state="pending"'),
      "Next production mismatched hydration entered the client cache",
    );
  } finally {
    await stopChild(nextProductionServer);
  }

  console.log(
    "package smoke: TS 5.4/5.9/7 declarations, React 18.3/19.2 claims and mutation retries, packed exports, Vite 8 browser/worker, and Next dev/prod graphs passed",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

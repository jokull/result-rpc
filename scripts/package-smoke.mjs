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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "result-rpc-package-smoke-"));
const fixture = join(temporary, "consumer");
const packDirectory = join(temporary, "pack");
const canary = "RESULT_RPC_SERVER_GRAPH_MUST_NOT_SHIP";
const serverRuntimeMarkers = [
  "class ProcedureImplementer",
  "class MiddlewareBuilder",
  "const createRouter =",
  "const executeProcedure =",
];

const write = (path, contents) => {
  const target = join(fixture, path);
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
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Vite dev exited before serving ${url}:\n${output.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The TCP listener is not ready yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Vite dev did not serve ${url} within 15 seconds:\n${output.join("")}`);
};

const stopChild = async (child) => {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Vite dev did not stop after SIGTERM")), 5_000),
    ),
  ]);
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
    "src/public-api.test-d.ts",
    rewritePublicTypeImports(readFileSync(join(root, "tests/public-api.test-d.ts"), "utf8")),
  );
  write(
    "src/model.test-d.ts",
    rewritePublicTypeImports(readFileSync(join(root, "tests/model.test-d.ts"), "utf8")),
  );

  execFileSync("pnpm", ["install", "--offline", "--ignore-scripts"], {
    cwd: fixture,
    stdio: "inherit",
  });

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

  execFileSync(resolve(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], {
    cwd: fixture,
    stdio: "inherit",
  });

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

  console.log(
    "package smoke: full public type suite, packed exports, declarations, Vite 8 dev, and Vite 8 prod passed",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

/**
 * Dev server for the browser entry: `bun run examples/07-tracker/serve.ts`.
 * Serves the RPC handler at /rpc (the same makeHandler and seeded world the
 * tests use) and bundles browser.tsx on demand.
 */
import type { AppContext } from "./server.js";
import { makeHandler } from "./server.js";
import { seedDb } from "./world.js";

const context: AppContext = {
  db: seedDb(),
  userId: "user-alice",
  fetchDirectory: async () => ({ memberIds: ["user-alice", "user-bob"] }),
};
const handler = makeHandler(context);

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>07-tracker</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 640px; }
  [role="alert"] { color: #b3261e; }
  section, main > * { margin-block: 0.75rem; }
</style>
</head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;

let bundled: string | undefined;
async function bundle(): Promise<string> {
  if (bundled) return bundled;
  const build = await Bun.build({
    entrypoints: [new URL("./browser.tsx", import.meta.url).pathname],
    target: "browser",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!build.success) throw new Error(build.logs.map(String).join("\n"));
  bundled = await build.outputs[0]!.text();
  return bundled;
}

const port = Number(process.env.PORT ?? 8791);
Bun.serve({
  port,
  idleTimeout: 120,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/rpc") return handler(request);
    if (url.pathname === "/app.js") {
      return new Response(await bundle(), { headers: { "content-type": "text/javascript" } });
    }
    return new Response(PAGE, { headers: { "content-type": "text/html" } });
  },
});
console.log(`07-tracker: http://localhost:${port}`);

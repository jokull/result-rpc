/**
 * Dev server for the browser entry: `bun run examples/07-tracker/serve.ts`.
 * Serves the RPC handler at /rpc (the same makeHandler the tests use, seeded
 * with the same world) and bundles browser.tsx on demand.
 */
import type { ActivityEvent } from "./models.js";
import { makeHandler, type AppContext, type TrackerDb } from "./server.js";

function seedDb(): TrackerDb {
  const activity: ActivityEvent[] = [
    { id: "act-1", issueId: "issue-1", message: "created by alice", at: new Date("2026-07-10T09:00:00Z") },
    { id: "act-2", issueId: "issue-1", message: "assigned to bob", at: new Date("2026-07-10T10:00:00Z") },
  ];
  return {
    users: new Map([
      ["user-alice", { id: "user-alice", name: "Alice" }],
      ["user-bob", { id: "user-bob", name: "Bob" }],
    ]),
    projects: new Map([
      ["proj-main", { id: "proj-main", name: "Main App", openCount: 1 }],
      ["proj-secret", { id: "proj-secret", name: "Skunkworks", openCount: 1 }],
    ]),
    issues: new Map([
      ["issue-1", { id: "issue-1", projectId: "proj-main", title: "Fix login bug", status: "open", assigneeId: "user-bob", closedAt: null }],
      ["issue-2", { id: "issue-2", projectId: "proj-main", title: "Archive old docs", status: "closed", assigneeId: "user-alice", closedAt: new Date("2026-07-01T12:00:00.000Z") }],
      ["issue-3", { id: "issue-3", projectId: "proj-secret", title: "Top secret", status: "open", assigneeId: null, closedAt: null }],
    ]),
    activity: new Map([["issue-1", activity]]),
  };
}

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

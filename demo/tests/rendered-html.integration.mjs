import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createBrowserClient, fetchTransport } from "result-rpc/client";
import { createQueryRuntime } from "result-rpc/query";
import { createTestHarness } from "wrangler";
import { appContract } from "../shared/contract.ts";
import { accessErrors, authErrors, ticketErrors } from "../shared/errors.ts";

const server = createTestHarness({
  workers: [
    {
      configPath: fileURLToPath(new URL("../dist/server/wrangler.json", import.meta.url)),
    },
  ],
});

before(async () => {
  await server.listen();
});

after(async () => {
  await server.close();
});

test("server-renders the branded demo shell from the production Worker", async () => {
  const response = await server.fetch("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Ticket cache demo · result-rpc<\/title>/i);
  assert.match(html, /result-rpc/);
  assert.match(html, /DEMO/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("runs pagination, detail, and mutation through the production RPC wire", async () => {
  const fetchThroughWorker = (input, init) => server.fetch(input, init);
  const client = createBrowserClient({
    contract: appContract,
    transport: fetchTransport({
      url: "http://result-rpc-demo.test/api/rpc",
      fetch: fetchThroughWorker,
      headers: { "x-demo-access": "writer", "x-demo-workspace": "ws_productiontest" },
    }),
    contractVersion: "result-rpc-demo-v2",
  });

  const page = await client.tickets.list({
    list: { status: "all", search: "" },
    cursor: null,
  });
  assert.equal(page.isOk(), true);
  if (!page.isOk()) return;
  assert.equal(page.value.items.length, 10);
  assert.equal(typeof page.value.nextCursor, "string");

  const ticket = page.value.items[0];
  assert.ok(ticket);
  const moved = await client.tickets.move({ id: ticket.id, status: "backlog" });
  assert.equal(moved.isOk(), true);
  if (moved.isOk()) assert.equal(moved.value.status, "backlog");

  const detail = await client.tickets.byId({ id: ticket.id });
  assert.equal(detail.isOk(), true);
  if (detail.isOk()) assert.equal(detail.value.status, "backlog");
});

test("keeps server-only implementation out of browser assets", async () => {
  const files = await readdir(new URL("../dist/client/assets/", import.meta.url));
  const scripts = files.filter((file) => file.endsWith(".js"));
  const browserCode = (
    await Promise.all(
      scripts.map((file) =>
        readFile(new URL(`../dist/client/assets/${file}`, import.meta.url), "utf8"),
      ),
    )
  ).join("\n");
  assert.doesNotMatch(browserCode, /RESULT_RPC_DEMO_SERVER_GRAPH_DO_NOT_SHIP/);
  assert.doesNotMatch(browserCode, /CREATE TABLE IF NOT EXISTS tickets/);
});

test("rejects production-Worker cache state from a different client contract", async () => {
  const fetchThroughWorker = (input, init) => server.fetch(input, init);
  const transport = fetchTransport({
    url: "http://result-rpc-demo.test/api/rpc",
    fetch: fetchThroughWorker,
    headers: { "x-demo-access": "writer", "x-demo-workspace": "ws_hydrationtest" },
  });
  const currentClient = createBrowserClient({
    contract: appContract,
    transport,
    contractVersion: "result-rpc-demo-v2",
  });
  const currentRuntime = createQueryRuntime({ client: currentClient });
  const prefetched = await currentRuntime.prefetchPaginated(currentClient.tickets.list, {
    status: "all",
    search: "",
  });
  assert.equal(prefetched.isOk(), true);
  const state = currentRuntime.dehydrate();

  const staleClient = createBrowserClient({
    contract: appContract,
    transport,
    contractVersion: "result-rpc-demo-stale",
  });
  const staleRuntime = createQueryRuntime({ client: staleClient });
  assert.throws(
    () => staleRuntime.hydrate(state),
    /does not match client contract result-rpc-demo-stale/,
  );
  currentRuntime.clear();
  staleRuntime.clear();
});

test("carries auth, write access, and conflict as distinct tagged failures", async () => {
  const fetchThroughWorker = (input, init) => server.fetch(input, init);
  const clientFor = (access) =>
    createBrowserClient({
      contract: appContract,
      transport: fetchTransport({
        url: "http://result-rpc-demo.test/api/rpc",
        fetch: fetchThroughWorker,
        headers: { "x-demo-access": access, "x-demo-workspace": "ws_errorstacktest" },
      }),
      contractVersion: "result-rpc-demo-v2",
    });

  const createInput = {
    id: "error-stack-ticket",
    title: "Prove the layered error stack",
    description: "A real mutation used by the production Worker integration.",
    priority: "high",
  };
  const signedOut = await clientFor("signed-out").tickets.create(createInput);
  assert.equal(signedOut.isOk(), false);
  if (!signedOut.isOk()) {
    assert.equal(authErrors.loginRequired.is(signedOut.error), true);
    assert.equal(signedOut.error.data.action, "create");
  }

  const readOnly = await clientFor("read-only").tickets.create(createInput);
  assert.equal(readOnly.isOk(), false);
  if (!readOnly.isOk()) {
    assert.equal(accessErrors.writeRequired.is(readOnly.error), true);
    assert.equal(readOnly.error.data.action, "create");
  }

  const writer = clientFor("writer");
  const page = await writer.tickets.list({
    list: { status: "all", search: "" },
    cursor: null,
  });
  assert.equal(page.isOk(), true);
  if (!page.isOk()) return;
  const ticket = page.value.items[0];
  assert.ok(ticket);

  const conflict = await writer.tickets.edit({
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    priority: ticket.priority,
    assignee: ticket.assignee,
    expectedUpdatedAt: new Date(0),
  });
  assert.equal(conflict.isOk(), false);
  if (!conflict.isOk()) {
    assert.equal(ticketErrors.conflict.is(conflict.error), true);
    assert.equal(conflict.error.data.ticketId, ticket.id);
    assert.equal(conflict.error.data.expectedUpdatedAt.getTime(), 0);
    assert.equal(conflict.error.data.actualUpdatedAt instanceof Date, true);
  }
});

import { defineModel, error, ok, rpc, wire } from "../src/index.js";
import { serverRpc } from "../src/server/index.js";
import { createBrowserClient } from "../src/client/index.js";
import { createQueryRuntime } from "../src/query/runtime.js";
import { defineShell } from "../src/react/index.js";

const server = serverRpc.context<{ readonly requestId: string }>();
const requiresDatabase = serverRpc
  .context<{ readonly database: string }>()
  .procedure()
  .output(wire.string)
  .query(() => ok("ready"));

server.router({ requiresDatabase }); // diagnostic: router-procedure-requires-incompatible-context

const databaseContract = rpc
  .context<{ readonly database: string }>()
  .procedure()
  .output(wire.string)
  .query();

server.implement(databaseContract); // diagnostic: procedure-contract-requires-incompatible-context

const requiresTenant = serverRpc
  .context<{ readonly tenantId: string }>()
  .middleware()
  .use(({ next }) => next({ context: {} }));

server.procedure().output(wire.string).use(requiresTenant); // diagnostic: middleware-requires-incompatible-context

const User = defineModel("diagnostic-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});

User.pick("name"); // diagnostic: model-selection-missing-identity-fields
User.$satisfies<{ readonly id: string; readonly name: string | null }>(); // diagnostic-text: field 'name': the model declares string, the source has string | null

const Unauthorized = error({ tag: "diagnostic/unauthorized" });
const Parent = defineShell({ name: "parent", claims: { Unauthorized } });

defineShell({ name: "child", from: Parent, claims: { Unauthorized } }); // diagnostic: shell-claim-already-owned-by-parent

server.procedure().query(() => ok("missing output")); // diagnostic: procedure-output-required

const queryA = rpc
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.string)
  .query();
const queryB = rpc
  .procedure()
  .input(wire.object({ page: wire.number }))
  .output(wire.number)
  .query();
const unionContract = rpc.contract({ queryA, queryB });
const unionClient = createBrowserClient({
  contract: unionContract,
  transport: { request: async () => ({ ok: false, reason: "network" }) },
});
declare const chooseQuery: boolean;
const selectedQuery = chooseQuery ? unionClient.queryA : unionClient.queryB;
const queryRuntime = createQueryRuntime({ client: unionClient });
queryRuntime.observe(selectedQuery, { id: "doc" }); // diagnostic: procedure-union-must-be-narrowed

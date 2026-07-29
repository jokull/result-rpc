/** Server-only implementation and fetch handler. */
import { err, ok } from "../../src/index.js";
import { createFetchHandler, serverRpc } from "../../src/server/index.js";
import { greetContract } from "./contract.js";

const server = serverRpc.context<{}>();

const greet = server
  .implement(greetContract)
  .handler(({ input, errors }) =>
    input.name === "nobody"
      ? err(errors.GreetingNotFound({ name: input.name }))
      : ok(`Hello, ${input.name}!`),
  );

export const router = server.router({ greet });

export const handler = createFetchHandler({
  router,
  createContext: () => ({}),
});

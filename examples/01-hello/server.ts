/** Server-only implementation and fetch handler. */
import { err, ok } from "../../src/index.js";
import { createFetchHandler } from "../../src/server/index.js";
import { app, greetContract } from "./contract.js";

const greet = app
  .implement(greetContract)
  .handler(({ input, errors }) =>
    input.name === "nobody"
      ? err(errors.GreetingNotFound({ name: input.name }))
      : ok(`Hello, ${input.name}!`),
  );

export const router = app.router({ greet });

export const handler = createFetchHandler({
  router,
  createContext: () => ({}),
});

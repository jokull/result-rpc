/**
 * Rung 1: the smallest possible result-rpc app.
 *
 * One query, one domain error, no shells. The point of this example is to feel
 * how many concepts stand between "npm install" and a rendered result.
 */
import { err, error, ok, rpc, wire } from "../../src/index.js";
import { createFetchHandler } from "../../src/server/index.js";
import { createClient, fetchTransport } from "../../src/client/index.js";
import { ResultRpcProvider, useResultQuery } from "../../src/react/index.js";

// -- shared -------------------------------------------------------------------

const GreetingNotFound = error({
  tag: "greeting/not-found",
  data: wire.object({ name: wire.string }),
  httpStatus: 404,
});

// -- server -------------------------------------------------------------------

const app = rpc.context<{}>();

export const router = app.router({
  greet: app.procedure()
    .input(wire.object({ name: wire.string }))
    .output(wire.string)
    .errors({ GreetingNotFound })
    .query(({ input, errors }) =>
      input.name === "nobody"
        ? err(errors.GreetingNotFound({ name: input.name }))
        : ok(`Hello, ${input.name}!`)),
});

export const handler = createFetchHandler({
  router,
  createContext: () => ({}),
});

// -- client -------------------------------------------------------------------

export const client = createClient({
  router,
  transport: fetchTransport({ url: "/rpc" }),
});

// -- ui -----------------------------------------------------------------------

export function App({ name }: { name: string }) {
  return (
    <ResultRpcProvider client={client}>
      <Greeting name={name} />
    </ResultRpcProvider>
  );
}

function Greeting({ name }: { name: string }) {
  const greeting = useResultQuery(client.greet, { name });

  switch (greeting.state) {
    case "pending":
      return <p>…</p>;
    case "success":
      return <p>{greeting.result.value}</p>;
    case "failure":
      switch (greeting.result.error._tag) {
        case "greeting/not-found":
          return <p>No greeting for {greeting.result.error.data.name}</p>;
        default:
          return <p>Something went wrong</p>;
      }
  }
}

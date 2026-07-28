/**
 * Rung 1: the smallest possible result-rpc app.
 *
 * One query, one domain error, no shells. Contract, server, and client live in
 * separate modules so the first example also demonstrates the browser
 * boundary correctly.
 */
import { ResultRpcProvider, useResultQuery } from "../../src/react/index.js";
import { client } from "./client.js";

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
      return <p>{greeting.value}</p>;
    case "failure":
      switch (greeting.error._tag) {
        case "greeting/not-found":
          return <p>No greeting for {greeting.error.data.name}</p>;
        default:
          return <p>Something went wrong</p>;
      }
  }
}

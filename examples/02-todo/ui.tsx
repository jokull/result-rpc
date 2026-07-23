/**
 * Rung 2, client: the basic onion (app shell + defect shell), an optimistic
 * mutation, and a message catalog keyed by error tag.
 *
 * The DX being tested: after the shells claim transport and defect tags, the
 * component's catalog should mention ONLY domain tags — and forgetting one
 * should fail to compile.
 */
import { errorCatalog, matchError } from "../../src/index.js";
import { createClient, batchFetchTransport } from "../../src/client/index.js";
import { boundaryShells, ResultRpcProvider } from "../../src/react/index.js";
import { todoContract, todoErrors } from "./contract.js";

// -- client wiring --------------------------------------------------------------

export const makeTodoClient = (fetch?: typeof globalThis.fetch) =>
  createClient({
    contract: todoContract,
    transport: batchFetchTransport({ url: "https://example.test/rpc", ...(fetch ? { fetch } : {}) }),
  });

export type TodoClient = ReturnType<typeof makeTodoClient>;

// -- shells -----------------------------------------------------------------------

/** The framework-owned rings, pre-assembled: pause, escalate, reload. */
export const { TransportShell, StaleShell, BoundaryProvider } = boundaryShells({
  name: "todo",
});

// -- ui ---------------------------------------------------------------------------

export function TodoApp({ client }: { client: TodoClient }) {
  return (
    <ResultRpcProvider client={client}>
      <BoundaryProvider>
        <ConnectivityBanner />
        <TodoList client={client} />
        <AddTodo client={client} />
      </BoundaryProvider>
    </ResultRpcProvider>
  );
}

function ConnectivityBanner() {
  const { latest, affected } = TransportShell.useHeld();
  if (!latest) return null;
  return <div role="alert">Connection trouble ({affected} requests waiting)</div>;
}

export function TodoList({ client }: { client: TodoClient }) {
  const todos = StaleShell.useQuery(client.list);

  switch (todos.state) {
    case "pending":
      return <p>Loading…</p>;
    case "success":
      return (
        <ul>
          {todos.result.value.map((todo) => (
            <TodoRow key={todo.id} client={client} id={todo.id} title={todo.title} done={todo.done} />
          ))}
        </ul>
      );
    case "failure":
      // transport + defect tags are claimed above; nothing domain remains on `list`
      return todos.result.error satisfies never;
  }
}

function TodoRow({ client, id, title, done }: {
  client: TodoClient;
  id: string;
  title: string;
  done: boolean;
}) {
  const toggle = StaleShell.useMutation(client.toggle, {
    optimistic: (input, cache) => ({
      rollback: cache.update(client.list, {}, (todos) =>
        todos?.map((todo) => (todo.id === input.id ? { ...todo, done: !todo.done } : todo))),
    }),
    onFailure: (_error, _input, context) => context?.rollback(),
    onSettled: (_result, _input, _context, cache) => cache.invalidate(client.list, {}),
  });

  return (
    <li>
      <label>
        <input type="checkbox" checked={done} onChange={() => void toggle.mutate({ id }).catch(() => undefined)} />
        {title}
      </label>
      {toggle.state === "failure" && (
        <span role="alert">
          {matchError(toggle.result.error, {
            "todo/not-found": () => "This todo no longer exists",
          })}
        </span>
      )}
    </li>
  );
}

export function AddTodo({ client }: { client: TodoClient }) {
  const add = StaleShell.useMutation(client.add);

  async function submit(title: string) {
    const result = await add.mutate({ title });
    if (result.ok) return;
    // domain-only union: TitleTaken | ListFull
    console.warn(catalog(result.error));
  }

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      const input = event.currentTarget.elements.namedItem("title") as HTMLInputElement;
      void submit(input.value);
    }}>
      <input name="title" disabled={add.state === "pending"} />
      {add.state === "failure" && <p role="alert">{catalog(add.result.error)}</p>}
    </form>
  );
}

/** One catalog per concern, keyed by the same definition map the contract uses. */
const { titleTaken, listFull } = todoErrors;
const catalog = errorCatalog({ titleTaken, listFull }, {
  "todo/title-taken": (failure) => `"${failure.data.title}" already exists`,
  "todo/list-full": (failure) => `The list is full (max ${failure.data.limit})`,
});

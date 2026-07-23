import { expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createTodoHandler, memoryStore } from "./server.js";
import { AddTodo, AppShell, makeTodoClient, TodoApp, TodoList } from "./ui.js";
import { createQueryRuntime, ResultRpcProvider } from "../../src/react/index.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const online = () => {
  const handler = createTodoHandler(memoryStore());
  return makeTodoClient(((input: string | URL | Request, init?: RequestInit) =>
    handler(new Request(input, init))) as typeof globalThis.fetch);
};

test("02-todo renders, adds, and surfaces domain errors through the catalog", async () => {
  const client = online();
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<TodoApp client={client} />);
    await settle();
  });

  // add twice with the same title → second hits the catalog
  const form = renderer!.root.findByType("form");
  const input = renderer!.root.findByType("input");
  for (const title of ["buy milk", "buy milk"]) {
    await act(async () => {
      (input.props as { onChange?: unknown });
      form.props.onSubmit({
        preventDefault: () => undefined,
        currentTarget: { elements: { namedItem: () => ({ value: title }) } },
      });
      await settle();
    });
  }

  const rendered = JSON.stringify(renderer!.toJSON());
  expect(rendered).toContain("buy milk");
  expect(rendered).toContain('\\"buy milk\\" already exists');
  await act(async () => renderer!.unmount());
});

test("02-todo pauses under the app shell when the network dies", async () => {
  const failingClient = makeTodoClient((() =>
    Promise.reject(new TypeError("fetch failed"))) as unknown as typeof globalThis.fetch);
  const runtime = createQueryRuntime({ client: failingClient });

  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <ResultRpcProvider runtime={runtime}>
        <AppShell.Provider>
          <TodoList client={failingClient} />
        </AppShell.Provider>
      </ResultRpcProvider>,
    );
    await settle();
  });
  // network failure is claimed by the app shell: still "Loading…", never a crash
  expect(JSON.stringify(renderer!.toJSON())).toContain("Loading…");
  await act(async () => renderer!.unmount());
  runtime.clear();
});

void AddTodo;

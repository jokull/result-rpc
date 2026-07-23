/**
 * Rung 2, server: implements the contract with an in-memory store.
 */
import { err, ok } from "../../src/index.js";
import { createFetchHandler } from "../../src/server/index.js";
import { app, todoContract, type Todo, type TodoStore } from "./contract.js";

const LIMIT = 5;

export const todoRouter = app.router({
  list: app.implement(todoContract.list)
    .handler(async ({ context }) => ok(await context.todos.all())),

  add: app.implement(todoContract.add)
    .handler(async ({ input, errors, context }) => {
      const existing = await context.todos.all();
      if (existing.length >= LIMIT) return err(errors.ListFull({ limit: LIMIT }));
      if (existing.some((todo) => todo.title === input.title)) {
        return err(errors.TitleTaken({ title: input.title }));
      }
      const todo: Todo = { id: `todo_${existing.length + 1}`, title: input.title, done: false };
      await context.todos.save(todo);
      return ok(todo);
    }),

  toggle: app.implement(todoContract.toggle)
    .handler(async ({ input, errors, context }) => {
      const todo = await context.todos.find(input.id);
      if (!todo) return err(errors.TodoNotFound({ todoId: input.id }));
      const toggled = { ...todo, done: !todo.done };
      await context.todos.save(toggled);
      return ok(toggled);
    }),
});

export const memoryStore = (): TodoStore => {
  const todos = new Map<string, Todo>();
  return {
    all: async () => [...todos.values()],
    find: async (id) => todos.get(id),
    save: async (todo) => void todos.set(todo.id, todo),
    delete: async (id) => void todos.delete(id),
  };
};

export const createTodoHandler = (todos: TodoStore) =>
  createFetchHandler({
    router: todoRouter,
    createContext: () => ({ todos }),
  });

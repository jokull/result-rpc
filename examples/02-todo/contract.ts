/**
 * Rung 2, shared contract: a todo list with domain errors worth branching on.
 */
import { defineErrors, pickErrors, wire, type InputOf } from "../../src/index.js";
import { rpc } from "../../src/contract/index.js";

/** One declaration per namespace; keys become tags (`todo/not-found`, ...). */
export const todoErrors = defineErrors("todo", {
  notFound: { data: wire.object({ todoId: wire.string }), httpStatus: 404 },
  titleTaken: { data: wire.object({ title: wire.string }), httpStatus: 409 },
  listFull: { data: wire.object({ limit: wire.integer({ min: 1 }) }), httpStatus: 409 },
});

export const TodoCodec = wire.object({
  id: wire.string,
  title: wire.string,
  done: wire.boolean,
});
export type Todo = InputOf<typeof TodoCodec>;

export interface TodoStore {
  all(): Promise<readonly Todo[]>;
  find(id: string): Promise<Todo | undefined>;
  save(todo: Todo): Promise<void>;
  delete(id: string): Promise<void>;
}

export const app = rpc.context<{ todos: TodoStore }>();

export const todoContract = app.contract({
  list: app.procedure()
    .output(wire.array(TodoCodec))
    .query(),
  add: app.procedure()
    .input(wire.object({ title: wire.string }))
    .output(TodoCodec)
    .errors(pickErrors(todoErrors, "titleTaken", "listFull"))
    .mutation(),
  toggle: app.procedure()
    .input(wire.object({ id: wire.string }))
    .output(TodoCodec)
    .errors(pickErrors(todoErrors, "notFound"))
    .mutation(),
});

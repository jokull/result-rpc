/**
 * Rung 2, shared contract: a todo list with domain errors worth branching on.
 */
import { error, wire, type InputOf } from "../../src/index.js";
import { rpc } from "../../src/contract/index.js";

export const TodoNotFound = error({
  tag: "todo/not-found",
  data: wire.object({ todoId: wire.string }),
  httpStatus: 404,
});

export const TitleTaken = error({
  tag: "todo/title-taken",
  data: wire.object({ title: wire.string }),
  httpStatus: 409,
});

export const ListFull = error({
  tag: "todo/list-full",
  data: wire.object({ limit: wire.integer({ min: 1 }) }),
  httpStatus: 409,
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
    .errors({ TitleTaken, ListFull })
    .mutation(),
  toggle: app.procedure()
    .input(wire.object({ id: wire.string }))
    .output(TodoCodec)
    .errors({ TodoNotFound })
    .mutation(),
});

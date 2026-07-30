/**
 * `result-rpc/db` — normalize common database failures into private Result
 * errors without taking a dependency on an ORM or driver.
 *
 * `tryDb` accepts any thenable (or a thunk for drivers that can throw while
 * preparing a query). It follows ordinary `Error.cause` chains and the
 * payload slots used by Effect Cause, then recognizes SQLite and PostgreSQL
 * constraint failures. Query text, parameters, and driver internals remain
 * only in the local non-enumerable `Error.cause`.
 */
import { defineErrors } from "./error.js";
import { err, ok, type Result } from "./result.js";
import { wire } from "./wire.js";

export type { NamespacedErrors } from "./error.js";
export type * from "./error.js";
export type * from "./result.js";
export type {
  AnyWireCodec,
  CodecIssue,
  DecodeResult,
  EmptyObject,
  EncodedOf,
  InputOf,
  WireCodec,
  WireScalar,
  WireTypedArray,
  WireValue,
} from "./wire.js";

/**
 * The database failure vocabulary as tagged errors. These are server-side
 * composition currency, never wire errors: all are private and should be
 * collapsed to declared domain errors at the procedure boundary.
 */
export const dbErrors = defineErrors("db", {
  uniqueViolation: {
    data: wire.object({ constraint: wire.string }),
    visibility: "private",
  },
  foreignKeyViolation: {
    data: wire.object({ constraint: wire.string }),
    visibility: "private",
  },
  notNullViolation: {
    data: wire.object({ constraint: wire.string }),
    visibility: "private",
  },
  checkViolation: {
    data: wire.object({ constraint: wire.string }),
    visibility: "private",
  },
  queryFailure: {
    // Deliberately empty on the wire side: query text and params are
    // sensitive. The thrown cause stays available to server observability.
    visibility: "private",
  },
});

export type DbError = ReturnType<(typeof dbErrors)[keyof typeof dbErrors]>;

const constraintFrom = (message: string): string => {
  // SQLite: "UNIQUE constraint failed: table.column[, table.column ...]".
  // Matches the column list and nothing after it. A looser class that admitted
  // whitespace would run past the list into whatever the driver or ORM appended
  // — including query parameters, which must never reach `data`.
  const sqlite = /constraint failed: ([\w.]+(?:,\s*[\w.]+)*)/i.exec(message);
  if (sqlite?.[1]) return sqlite[1].trim();
  // Postgres: ... violates unique constraint "name"
  const pg = /constraint "([^"]+)"/.exec(message);
  return pg?.[1] ?? "unknown";
};

const classify = (cause: unknown): DbError => {
  const pending: unknown[] = [cause];
  const visited = new Set<object>();
  for (let inspected = 0; inspected < 16 && pending.length > 0; inspected += 1) {
    const current = pending.shift();
    if (typeof current !== "object" || current === null) continue;
    if (visited.has(current)) continue;
    visited.add(current);
    const messageValue = Reflect.get(current, "message");
    const message = typeof messageValue === "string" ? messageValue : "";
    const code = Reflect.get(current, "code");
    const errcode = Reflect.get(current, "errcode");
    if (typeof code === "string") {
      const constraint = constraintFrom(message);
      if (
        code.startsWith("SQLITE_CONSTRAINT_UNIQUE") ||
        code.startsWith("SQLITE_CONSTRAINT_PRIMARYKEY") ||
        code === "23505"
      ) {
        return dbErrors.uniqueViolation({ constraint }, { cause });
      }
      if (code.startsWith("SQLITE_CONSTRAINT_FOREIGNKEY") || code === "23503") {
        return dbErrors.foreignKeyViolation({ constraint }, { cause });
      }
      if (code.startsWith("SQLITE_CONSTRAINT_NOTNULL") || code === "23502") {
        return dbErrors.notNullViolation({ constraint }, { cause });
      }
      if (code.startsWith("SQLITE_CONSTRAINT_CHECK") || code === "23514") {
        return dbErrors.checkViolation({ constraint }, { cause });
      }
    }
    // Node's built-in SQLite driver reports every SQLite failure with the
    // generic ERR_SQLITE_ERROR code and puts the extended SQLite result code
    // in `errcode`. ORM wrappers commonly retain it on Error.cause.
    const constraint = constraintFrom(message);
    if (errcode === 2067 || errcode === 1555 || /^UNIQUE constraint failed:/i.test(message)) {
      return dbErrors.uniqueViolation({ constraint }, { cause });
    }
    if (errcode === 787 || /^FOREIGN KEY constraint failed/i.test(message)) {
      return dbErrors.foreignKeyViolation({ constraint }, { cause });
    }
    if (errcode === 1299 || /^NOT NULL constraint failed:/i.test(message)) {
      return dbErrors.notNullViolation({ constraint }, { cause });
    }
    if (errcode === 275 || /^CHECK constraint failed:/i.test(message)) {
      return dbErrors.checkViolation({ constraint }, { cause });
    }
    // Follow both ordinary Error.cause and the small set of Effect Cause
    // payload slots without taking an Effect dependency.
    pending.push(
      ...["cause", "failure", "error", "defect"].map((key) => Reflect.get(current, key)),
    );
  }
  return dbErrors.queryFailure({}, { cause });
};

/**
 * Runs any database query and resolves the outcome as a Result. Constraint
 * outcomes become values a handler can collapse into its domain vocabulary;
 * attempting the insert is the uniqueness check, including under races.
 *
 * The original caught failure remains available as a non-enumerable,
 * non-wire `Error.cause` on the private tagged error.
 */
function runDbQuery<T>(query: PromiseLike<T> | (() => PromiseLike<T> | T)): PromiseLike<T> | T;
function runDbQuery(
  query: PromiseLike<unknown> | (() => PromiseLike<unknown> | unknown),
): PromiseLike<unknown> | unknown {
  return typeof query === "function" ? query() : query;
}

export const tryDb = async <T>(
  query: PromiseLike<T> | (() => PromiseLike<T> | T),
): Promise<Result<T, DbError>> => {
  try {
    return ok(await runDbQuery(query));
  } catch (cause) {
    return err(classify(cause));
  }
};

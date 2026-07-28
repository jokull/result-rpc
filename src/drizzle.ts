/**
 * `result-rpc/drizzle` — derive entity models from Drizzle tables.
 *
 * The dual-model tax, deleted: a Drizzle table already declares columns,
 * types, nullability, and the primary key — the exact facts `defineModel`
 * asks for. `modelFromDrizzle` reads them, so the wire model cannot drift
 * from the database because it is derived from the same schema the
 * migration maintains.
 *
 * ```ts
 * import { hotels, tourContent } from "./schema"
 *
 * export const Hotel = modelFromDrizzle("hotel", hotels, {
 *   columns: ["id", "name", "phone", "city"],   // explicit allowlist, always
 * })
 * export const TourContent = modelFromDrizzle("tour-content", tourContent, {
 *   columns: ["id", "locale", "title", "summary"],
 *   key: ["id", "locale"],                       // composite PKs are declared
 * })
 * ```
 *
 * Two deliberate frictions remain:
 * - `columns` is required. A wire contract that silently grows when a
 *   migration adds a column is a security bug, not a convenience —
 *   `passwordHash` never ships because nobody named it.
 * - Composite keys are named explicitly (Drizzle exposes inline
 *   `.primaryKey()` on the column, but table-level `primaryKey({columns})`
 *   lives in an opaque config builder). Single inline PKs are derived.
 *
 * Requires drizzle-orm >= 1.0 (an optional peer — this subpath is the only
 * one that imports it).
 */
import { getTableColumns, type Column, type InferSelectModel, type Table } from "drizzle-orm";
import { defineErrors } from "./error.js";
import { defineModel, type ModelDefinition } from "./model.js";
import { err, ok, type Result } from "./result.js";
import { wire, type WireCodec, type WireValue } from "./wire.js";

type SelectOf<TTable extends Table> = InferSelectModel<TTable>;

export type DrizzleModelShape<
  TTable extends Table,
  TCols extends keyof SelectOf<TTable> & string,
> = {
  readonly [K in TCols]: WireCodec<SelectOf<TTable>[K], WireValue>;
};

export interface ModelFromDrizzleOptions<
  TTable extends Table,
  TCols extends readonly (keyof SelectOf<TTable> & string)[],
> {
  /** The wire allowlist. Only named columns exist on the model — always explicit. */
  readonly columns: TCols;
  /**
   * The identity field(s). Defaults to the single inline `.primaryKey()`
   * column when exactly one exists among `columns`; table-level composite
   * primary keys must be named here.
   */
  readonly key?: (TCols[number] & string) | readonly (TCols[number] & string)[];
}

const codecForColumn = (name: string, column: Column): WireCodec<unknown, WireValue> => {
  const base = ((): WireCodec<unknown, WireValue> | undefined => {
    const kind: string = column.dataType;
    if (kind.startsWith("string enum") && column.enumValues && column.enumValues.length > 0) {
      const literals = column.enumValues.map((value) => wire.literal(value));
      return (literals.length === 1
        ? literals[0]
        : wire.union(literals as never)) as WireCodec<unknown, WireValue>;
    }
    if (kind.startsWith("string")) return wire.string as WireCodec<unknown, WireValue>;
    if (kind.startsWith("number")) return wire.number as WireCodec<unknown, WireValue>;
    if (kind.startsWith("boolean")) return wire.boolean as WireCodec<unknown, WireValue>;
    if (kind.startsWith("bigint")) return wire.bigint as WireCodec<unknown, WireValue>;
    if (kind.startsWith("object date") || kind.startsWith("date")) {
      return wire.date as WireCodec<unknown, WireValue>;
    }
    if (kind.startsWith("object json") || kind.startsWith("json")) {
      return wire.serializable() as WireCodec<unknown, WireValue>;
    }
    return undefined;
  })();
  if (!base) {
    throw new TypeError(
      `modelFromDrizzle: column "${name}" has data type "${column.dataType}", which has no wire mapping — declare this model by hand with defineModel`,
    );
  }
  return column.notNull
    ? base
    : (wire.union([base, wire.null] as never) as WireCodec<unknown, WireValue>);
};

export const modelFromDrizzle = <
  const TName extends string,
  TTable extends Table,
  const TCols extends readonly (keyof SelectOf<TTable> & string)[],
>(
  name: TName,
  table: TTable,
  options: ModelFromDrizzleOptions<TTable, TCols>,
): ModelDefinition<TName, DrizzleModelShape<TTable, TCols[number]>> => {
  const tableColumns = getTableColumns(table) as Record<string, Column>;
  const shape: Record<string, WireCodec<unknown, WireValue>> = {};
  for (const columnName of options.columns) {
    const column = tableColumns[columnName];
    if (!column) {
      throw new TypeError(
        `modelFromDrizzle: table has no column "${String(columnName)}" for model ${name}`,
      );
    }
    shape[columnName] = codecForColumn(columnName, column);
  }
  const key = options.key ?? ((): string => {
    const primaries = options.columns.filter((columnName) =>
      tableColumns[columnName]?.primary === true);
    if (primaries.length === 1) return primaries[0] as string;
    throw new TypeError(
      primaries.length === 0
        ? `modelFromDrizzle: no inline primary key among the selected columns of ${name} — pass \`key\` explicitly (table-level composite primary keys cannot be introspected)`
        : `modelFromDrizzle: multiple primary-key columns selected for ${name} — pass \`key\` explicitly`,
    );
  })();
  return defineModel(name, { key, shape }) as unknown as ModelDefinition<
    TName,
    DrizzleModelShape<TTable, TCols[number]>
  >;
};

// --- The Result-typed query door ----------------------------------------------

/**
 * The database's failure vocabulary as tagged errors — the Result-native
 * parallel of Drizzle 1.0's Effect bridge. These are SERVER-SIDE composition
 * currency, never wire errors: all are `visibility: "private"`, none should
 * appear in a procedure's `.errors()`. Handlers compose with them
 * (`gen`/`yield*`/`matchError`) and collapse to declared domain tags at the
 * boundary — a unique violation becomes `titleTaken`, honestly and without
 * the race-prone pre-check SELECT. One that slips through uncollapsed hits
 * the undeclared-tag safety net and sanitizes to `server/internal`.
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
  // SQLite: "UNIQUE constraint failed: table.column[, ...]"
  const sqlite = /constraint failed: ([\w.,\s]+)/i.exec(message);
  if (sqlite?.[1]) return sqlite[1].trim();
  // Postgres: ... violates unique constraint "name"
  const pg = /constraint "([^"]+)"/.exec(message);
  return pg?.[1] ?? "unknown";
};

const classify = (cause: unknown): DbError => {
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      const constraint = constraintFrom(current.message);
      if (code.startsWith("SQLITE_CONSTRAINT_UNIQUE")
        || code.startsWith("SQLITE_CONSTRAINT_PRIMARYKEY")
        || code === "23505") {
        return dbErrors.uniqueViolation({ constraint });
      }
      if (code.startsWith("SQLITE_CONSTRAINT_FOREIGNKEY") || code === "23503") {
        return dbErrors.foreignKeyViolation({ constraint });
      }
      if (code.startsWith("SQLITE_CONSTRAINT_NOTNULL") || code === "23502") {
        return dbErrors.notNullViolation({ constraint });
      }
      if (code.startsWith("SQLITE_CONSTRAINT_CHECK") || code === "23514") {
        return dbErrors.checkViolation({ constraint });
      }
    }
    current = current.cause;
  }
  return dbErrors.queryFailure();
};

/**
 * Runs a Drizzle query (queries are thenables — pass them directly) and
 * resolves the outcome as a Result:
 *
 * ```ts
 * const inserted = await tryDb(db.insert(reviews).values(row).returning())
 * if (!inserted.ok) {
 *   return matchError(inserted.error, {
 *     "db/unique-violation": () => err(errors.alreadyReviewed({ hotelId })),
 *     "db/foreign-key-violation": () => err(errors.hotelNotFound({ hotelId })),
 *     "db/not-null-violation": rethrow, ...
 *   })
 * }
 * ```
 *
 * Constraint outcomes become values a handler can branch on — attempting the
 * insert IS the uniqueness check, correct under concurrency where the
 * SELECT-first idiom races.
 */
export const tryDb = async <T>(
  query: PromiseLike<T> | (() => PromiseLike<T> | T),
): Promise<Result<T, DbError>> => {
  try {
    // Accept a thunk too: some drivers throw synchronously at prepare time,
    // before a promise exists to reject.
    return ok(await (typeof query === "function" ? (query as () => PromiseLike<T> | T)() : query));
  } catch (cause) {
    return err(classify(cause));
  }
};

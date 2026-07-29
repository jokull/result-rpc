/** A normal procedure with one input and one output. */
export interface UnaryProcedureCapability<TWritesHeaders extends boolean = false> {
  readonly mode: "unary";
  readonly writesHeaders: TWritesHeaders;
}

/**
 * A query whose list identity, cursor, and row types are correlated.
 *
 * The declared field is type-only: it gives conditional types a required
 * inference site without adding placeholder data to the runtime manifest.
 */
export class PaginatedProcedureCapability<
  TListInput,
  TCursor,
  TItem,
  TWritesHeaders extends boolean = false,
> {
  readonly mode = "paginated" as const;
  constructor(readonly writesHeaders: TWritesHeaders) {}
  declare readonly _types: {
    readonly listInput: TListInput;
    readonly cursor: TCursor;
    readonly item: TItem;
  };
}

export type ProcedureCapability =
  | UnaryProcedureCapability<boolean>
  | PaginatedProcedureCapability<unknown, unknown, unknown, boolean>;

export const unaryProcedureCapability = <const TWritesHeaders extends boolean>(
  writesHeaders: TWritesHeaders,
): UnaryProcedureCapability<TWritesHeaders> => Object.freeze({ mode: "unary", writesHeaders });

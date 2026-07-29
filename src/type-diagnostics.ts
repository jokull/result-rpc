declare const rpcConstraintError: unique symbol;

/** A named public constraint failure used in editor diagnostics instead of `never`. */
export interface RpcConstraintError<TCode extends string, TDetails = unknown> {
  readonly [rpcConstraintError]: {
    readonly code: TCode;
    readonly details: TDetails;
  };
}

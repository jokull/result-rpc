export {
  andThen,
  err,
  tap,
  tapBoth,
  tapError,
  isErr,
  isOk,
  map,
  mapError,
  match,
  matchError,
  ok,
} from "./result.js";
export type { Err, Ok, Result } from "./result.js";

export { defineErrors, error, errorCatalog, httpStatusNames, pickErrors } from "./error.js";
export type {
  AnyTaggedError,
  ErrorSpec,
  HttpStatusName,
  NamespacedErrors,
  ErrorDefinition,
  ErrorDefinitionOptions,
  ErrorOf,
  ErrorPolicy,
  ErrorSeverity,
  ErrorVisibility,
  RetryPolicy,
  TaggedError,
} from "./error.js";

export { defineService, resolveServices } from "./service.js";
export type {
  AnyServiceDefinition,
  DefineServiceOptions,
  ResolvedServices,
  ServiceDefinition,
  ServiceDefinitionMap,
  ServiceValue,
} from "./service.js";

export { defineLayer } from "./layer.js";
export type { AnyLayer, DefineLayerOptions, Layer, LayerErrors, LayerShape, LayerValue, RequiredLayer } from "./layer.js";

export { rpc } from "./server/contract.js";
export type {
  AnyProcedure,
  AnyProcedureContract,
  AnySubscriptionProcedure,
  AnyUnaryProcedure,
  ContractRouterRecord,
  ErrorDefinitionMap,
  ErrorUnion,
  Middleware,
  MiddlewareHandler,
  Procedure,
  ProcedureContract,
  ProcedureContractManifest,
  ProcedureError,
  ProcedureInput,
  ProcedureOutput,
  Router,
  RouterContract,
  RouterContext,
  RouterErrors,
  RouterInputs,
  RouterOutputs,
  RouterRecord,
  RpcFactory,
  SubscriptionProcedure,
  SubscriptionProcedureManifest,
} from "./server/contract.js";

export { wire } from "./wire.js";
export type {
  CodecIssue,
  DecodeResult,
  EncodedOf,
  FileOptions,
  InputOf,
  WireCodec,
  WireScalar,
  WireValue,
} from "./wire.js";

export { deserialize, DEFAULT_MAX_WIRE_BYTES, serialize } from "./serializer.js";
export type { SerializationOptions, SerializationResult } from "./serializer.js";

// Each framework error is both the definition (value) and its error type.
export {
  ClientDecodeFailure,
  ClientHttpFailure,
  ClientNetworkFailure,
  ClientOffline,
  ClientProtocolViolation,
  ClientStale,
  ClientTimeout,
  defectErrors,
  ServerBadRequest,
  ServerInternal,
  staleErrors,
  transportErrors,
} from "./framework-errors.js";
export type { ClientBoundaryError } from "./framework-errors.js";

export { contractDigest } from "./contract-digest.js";

export { fieldIssues, toStandardSchema } from "./standard-schema.js";
export type {
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
} from "./standard-schema.js";

export {
  all,
  andThen,
  err,
  gen,
  getOrElse,
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
  orElse,
  tryCatch,
  tryPromise,
} from "./result.js";
export type { Err, Ok, Result } from "./result.js";
export type { RpcConstraintError } from "./type-diagnostics.js";

export {
  TaggedError,
  defineErrors,
  error,
  errorCatalog,
  httpStatusNames,
  isTaggedError,
  pickErrors,
} from "./error.js";
export type {
  AnyPublicErrorDefinition,
  AnyPublicTaggedError,
  AnyTaggedError,
  EncodedTaggedError,
  ErrorCatalog,
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
export type {
  AnyLayer,
  DefineLayerOptions,
  Layer,
  LayerErrors,
  LayerShape,
  LayerValue,
  RequiredLayer,
} from "./layer.js";

export { rpc } from "./contract.js";
export type { ContractFactory } from "./contract.js";
export type {
  AnyProcedure,
  AnyPaginatedProcedure,
  AnyProcedureContract,
  AnySubscriptionProcedure,
  AnyUnaryProcedure,
  ContractRouterRecord,
  ErrorDefinitionMap,
  ErrorUnion,
  Middleware,
  MiddlewareHandler,
  Page,
  PageRequest,
  PaginationManifest,
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
  SubscriptionProcedure,
  SubscriptionProcedureManifest,
} from "./server/contract.js";

export { wire } from "./wire.js";
export type {
  AnyWireCodec,
  CodecIssue,
  DecodeResult,
  EmptyObject,
  EncodedOf,
  InputOf,
  WireCodec,
  WireGuard,
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

export { defineModel, entityIdFor } from "./model.js";
export type {
  AnyModel,
  DefineModelOptions,
  ModelDefinition,
  ModelKeyInput,
  ModelProjection,
  ModelValue,
} from "./model.js";

export { fieldIssues, validateStandard } from "./standard-schema.js";
export type { StandardValidation } from "./standard-schema.js";
export type {
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
} from "./standard-schema.js";

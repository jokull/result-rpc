export {
  andThen,
  err,
  isErr,
  isOk,
  map,
  mapError,
  match,
  matchError,
  ok,
} from "./result.js";
export type { Err, Ok, Result } from "./result.js";

export { error, errorCatalog } from "./error.js";
export type {
  AnyTaggedError,
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

export { wire } from "./wire.js";
export type {
  CodecIssue,
  DecodeResult,
  EncodedOf,
  InputOf,
  WireCodec,
  WireScalar,
  WireValue,
} from "./wire.js";

export {
  deserialize,
  DEFAULT_MAX_ERROR_BYTES,
  DEFAULT_MAX_WIRE_BYTES,
  isSerializable,
  SERIALIZER_NAME,
  SERIALIZER_VERSION,
  serialize,
} from "./serializer.js";
export type { SerializationOptions, SerializationResult } from "./serializer.js";

export {
  ClientDecodeFailure,
  ClientHttpFailure,
  ClientNetworkFailure,
  ClientOffline,
  ClientProtocolViolation,
  ClientTimeout,
  defectErrors,
  ServerInternal,
  transportErrors,
} from "./framework-errors.js";
export type {
  ClientBoundaryError,
  DecodeFailure,
  HttpFailure,
  NetworkFailure,
  Offline,
  ProtocolViolation,
  ServerInternal as ServerInternalError,
  Timeout,
} from "./framework-errors.js";

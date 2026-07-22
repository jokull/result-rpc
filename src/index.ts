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

export { error } from "./error.js";
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
  ServerInternal,
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

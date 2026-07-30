/**
 * The server runtime. Shared contracts use `rpc` from the package root;
 * middleware, implementations, and executable routers use `serverRpc` here.
 */
export { createFetchHandler } from "./http.js";
export type { ErrorResponseEvent, FetchHandlerOptions } from "./http.js";
export { createServerClient } from "./server-client.js";
export { rpc as serverRpc } from "./contract.js";
export type * from "./contract.js";
export type * from "../client/base-client.js";
export type * from "../error.js";
export type * from "../error-map.js";
export type * from "../factory-types.js";
export type * from "../procedure-types.js";
export type * from "../procedure-declaration.js";
export type * from "../result.js";
export type * from "../type-diagnostics.js";
export type * from "../types.js";
export type {
  AnyModel,
  DefineModelOptions,
  EntityId,
  KeyField,
  ModelDefinition,
  ModelIdentityField,
  ModelKeyInput,
  ModelKeyRecord,
  ModelKeySpec,
  ModelProjection,
  ModelSourceMismatch,
  ModelTypeCompatible,
  ModelTypeEqual,
  MutableModelType,
  ModelValue,
  MismatchedSourceFields,
  PrintModelType,
  SourceFieldMessage,
  ScalarKeyField,
  SelectedOwnFields,
  SelectionInput,
  SelectionValue,
  ShapeKeySpec,
  SpecificModelKeyInput,
} from "../model.js";
export type {
  AnyWireCodec,
  CodecIssue,
  CodecShape,
  DecodeResult,
  EmptyObject,
  EncodedOf,
  ExternalWireSchemaOptions,
  InputOf,
  IntegerOptions,
  OptionalShapeKeys,
  RequiredShapeKeys,
  ShapeEncoded,
  ShapeInput,
  WireCodec,
  WireGuard,
  WireScalar,
  WireTypedArray,
  WireValue,
} from "../wire.js";
export type {
  CreateServerClientOptions,
  ServerCallArgs,
  ServerCallOptions,
  ServerBoundaryError,
  ServerClientErrorOf,
  ServerClientOf,
  ServerClientRecord,
  ServerProcedureClient,
} from "./server-client.js";
export type {
  ExecutionOptions,
  InternalErrorEvent,
  ProcedureHandlerArgs,
  SubscriptionHandlerArgs,
} from "./contract.js";
export type { RpcFactory as ServerRpcFactory } from "./contract.js";
export type { EffectiveContractVersion } from "../contract-digest.js";
export { ServerBadRequest, ServerInternal } from "../framework-errors.js";
export type { AnyTaggedError, ErrorPolicy } from "../error.js";
export type { RpcFactoryTypeCarrier, RpcFactoryTypes } from "../factory-types.js";
export type {
  BaseClientOf,
  ClientCallArgs,
  ClientErrorOf,
  ClientRecord,
  ProcedureClient,
} from "../client/base-client.js";

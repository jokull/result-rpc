import type { AnyErrorDefinition } from "./error.js";
/**
 * A stable structural fingerprint of a router or contract: procedure paths,
 * capabilities, complete input/output codec schemas, and every declared error
 * schema and policy. A router and the contract it implements digest identically.
 */
/** Runtime structural facts consumed by contract fingerprinting. */
export interface ContractDigestManifest {
    readonly kind: string;
    readonly input: {
        readonly schema: string;
    };
    readonly output: {
        readonly schema: string;
    };
    readonly definitions: Readonly<Record<string, AnyErrorDefinition>>;
    readonly pagination?: {
        readonly cursor: {
            readonly schema: string;
        };
        readonly item: {
            readonly schema: string;
        };
    };
    readonly writesHeaders?: true;
    readonly resumable?: unknown;
}
/** A router- or contract-shaped source accepted by {@link contractDigest}. */
export interface ContractDigestSource {
    readonly procedures: ReadonlyMap<string, {
        readonly _def: ContractDigestManifest;
    }>;
}
/**
 * The single version that identifies a client/server contract at runtime.
 * It is either the application's explicit build stamp or the derived contract
 * digest — never both at different boundaries of the same client.
 */
export type EffectiveContractVersion = string;
export declare const contractDigest: (routerOrContract: ContractDigestSource) => string;
export declare const effectiveContractVersion: (routerOrContract: ContractDigestSource, configured?: string) => EffectiveContractVersion;

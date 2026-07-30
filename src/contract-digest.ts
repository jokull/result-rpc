import type { AnyErrorDefinition } from "./error.js";

/**
 * A stable structural fingerprint of a router or contract: procedure paths,
 * capabilities, complete input/output codec schemas, and every declared error
 * schema and policy. A router and the contract it implements digest identically.
 */

/** Runtime structural facts consumed by contract fingerprinting. */
export interface ContractDigestManifest {
  readonly kind: string;
  readonly input: { readonly schema: string };
  readonly output: { readonly schema: string };
  readonly definitions: Readonly<Record<string, AnyErrorDefinition>>;
  readonly pagination?: {
    readonly cursor: { readonly schema: string };
    readonly item: { readonly schema: string };
  };
  readonly writesHeaders?: true;
  readonly resumable?: unknown;
}

/** A router- or contract-shaped source accepted by {@link contractDigest}. */
export interface ContractDigestSource {
  readonly procedures: ReadonlyMap<string, { readonly _def: ContractDigestManifest }>;
}

/**
 * The single version that identifies a client/server contract at runtime.
 * It is either the application's explicit build stamp or the derived contract
 * digest — never both at different boundaries of the same client.
 */
export type EffectiveContractVersion = string;

const fnv1a = (text: string, seed: number): number => {
  let hash = seed;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export const contractDigest = (routerOrContract: ContractDigestSource): string => {
  const lines = [...routerOrContract.procedures.entries()]
    .map(([path, procedure]) => {
      const manifest = procedure._def;
      const errors = Object.values(manifest.definitions)
        .map(
          (definition) =>
            `${JSON.stringify(definition.tag)}#${definition.codec.schema}/${definition.policy.httpStatus ?? "-"}/${definition.policy.retry}/${definition.policy.visibility}/${definition.policy.severity ?? "-"}`,
        )
        .sort()
        .join(",");
      const paginated =
        manifest.pagination === undefined
          ? ""
          : `|paginated:cursor:${manifest.pagination.cursor.schema}:item:${manifest.pagination.item.schema}`;
      // In the digest because a client that disagrees about this would batch a
      // header-writing call the wrong way and drop its `set-cookie` silently.
      const headers = manifest.writesHeaders === true ? "|headers" : "";
      // A client that disagrees about resumability either sends a resume point
      // the server ignores, or sends none and silently re-receives events.
      const resumable = manifest.resumable === undefined ? "" : "|resumable";
      return `${JSON.stringify(path)}|${manifest.kind}${paginated}${headers}${resumable}|in:${manifest.input.schema}|out:${manifest.output.schema}|${errors}`;
    })
    .sort()
    .join("\n");
  const high = fnv1a(lines, 0x811c9dc5);
  const low = fnv1a(lines, 0x9747b28c);
  return `${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`;
};

export const effectiveContractVersion = (
  routerOrContract: ContractDigestSource,
  configured?: string,
): EffectiveContractVersion => {
  if (configured !== undefined && configured.length === 0) {
    throw new TypeError("contractVersion must not be empty");
  }
  return configured ?? contractDigest(routerOrContract);
};

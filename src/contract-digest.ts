import type { AnyErrorDefinition } from "./error.js";

/**
 * A stable fingerprint of a router or contract's shape: procedure paths and
 * kinds, top-level input/output codec kinds, and every declared error tag
 * with its policy. A router and the contract it implements digest identically.
 *
 * The digest deliberately reads only what codecs expose (their `kind`), so a
 * field-level change inside an object codec does not flip it — pass an
 * explicit `contractVersion` (e.g. a build stamp) to both sides when exact
 * per-deploy detection matters. Detection is failure-gated, so a coarser
 * version is safe: matching successful calls are never affected.
 */

interface DigestibleManifest {
  readonly kind: string;
  readonly input: { readonly kind: string };
  readonly output: { readonly kind: string };
  readonly definitions: Readonly<Record<string, AnyErrorDefinition>>;
}

interface Digestible {
  readonly procedures: ReadonlyMap<string, { readonly _def: DigestibleManifest }>;
}

const fnv1a = (text: string, seed: number): number => {
  let hash = seed;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export const contractDigest = (routerOrContract: Digestible): string => {
  const lines = [...routerOrContract.procedures.entries()]
    .map(([path, procedure]) => {
      const manifest = procedure._def;
      const errors = Object.values(manifest.definitions)
        .map((definition) =>
          `${definition.tag}#${definition.policy.httpStatus}/${definition.policy.retry}/${definition.policy.visibility}`)
        .sort()
        .join(",");
      return `${path}|${manifest.kind}|in:${manifest.input.kind}|out:${manifest.output.kind}|${errors}`;
    })
    .sort()
    .join("\n");
  const high = fnv1a(lines, 0x811c9dc5);
  const low = fnv1a(lines, 0x9747b28c);
  return `${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`;
};

import type { NextConfig } from "next";

/**
 * The example depends on the WORKSPACE BUILD of result-rpc via
 * `"result-rpc": "file:../.."` in package.json — pnpm packs the real
 * `files`/`exports` of the published package into the store, so every import
 * here (`result-rpc/query`, `/react`, `/server`, `/client`, `/drizzle`)
 * resolves through the same `exports` map an npm consumer gets. No aliases,
 * no `transpilePackages`: dist is already plain ESM with a `'use client'`
 * directive on the react entry, which is exactly what Next wants.
 */
const nextConfig: NextConfig = {
  /** Native addon — never bundle it into the server output. */
  serverExternalPackages: ["better-sqlite3"],

  turbopack: {
    // The repo root also has a lockfile; pin the root so Turbopack does not
    // infer it and widen the module graph.
    root: import.meta.dirname,

    // WORKAROUND (Turbopack, not result-rpc): the `drizzle-orm` root entry is
    // a pure re-export barrel with `"sideEffects": false`, and Turbopack
    // tree-shakes it down to an EMPTY namespace — `import { asc } from
    // "drizzle-orm"` yields `undefined` at runtime, in every server graph.
    // Aliasing the bare specifier straight at the file skips barrel analysis.
    // `next build --webpack` and plain node have no such problem. Deep
    // subpaths (`drizzle-orm/sqlite-core`) are unaffected either way.
    resolveAlias: { "drizzle-orm": "drizzle-orm/index.js" },
  },
};

export default nextConfig;

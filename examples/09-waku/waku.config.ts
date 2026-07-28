/**
 * The example consumes the WORKSPACE BUILD of result-rpc (`../../dist`)
 * through Vite aliases — the same files `npm publish` would ship. Order
 * matters: subpath entries must come before the bare `result-rpc` entry,
 * because @rollup/plugin-alias string finds also match as prefixes.
 *
 * `resolve.dedupe` keeps ONE copy of React: the aliased dist files live
 * outside this package root and would otherwise resolve React from the
 * repo-root node_modules — two React copies break hooks silently.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "waku/config";

const dist = (p: string) => fileURLToPath(new URL(`../../dist/${p}`, import.meta.url));

export default defineConfig({
  vite: {
    resolve: {
      alias: [
        // Extra (not a published subpath): the react-free query runtime, so
        // SERVER components can build a prefetch runtime under the
        // react-server condition, where `result-rpc/react` cannot load
        // (its module scope calls React.createContext). See NOTES.md.
        { find: "result-rpc/query", replacement: dist("query/runtime.js") },
        { find: "result-rpc/react", replacement: dist("react/index.js") },
        { find: "result-rpc/server", replacement: dist("server/index.js") },
        { find: "result-rpc/client", replacement: dist("client/index.js") },
        { find: "result-rpc/db", replacement: dist("db.js") },
        { find: "result-rpc/testing", replacement: dist("testing/index.js") },
        { find: "result-rpc", replacement: dist("index.js") },
      ],
      dedupe: ["react", "react-dom"],
    },
    ssr: {
      external: ["better-sqlite3"],
    },
    // The native driver must stay external in EVERY server environment —
    // bundling better-sqlite3 inlines `bindings`, which relies on
    // CommonJS __filename and crashes the ESM server build.
    environments: {
      rsc: { resolve: { external: ["better-sqlite3"] } },
      ssr: { resolve: { external: ["better-sqlite3"] } },
    },
    server: {
      fs: {
        allow: [fileURLToPath(new URL("../..", import.meta.url))],
      },
    },
  },
});

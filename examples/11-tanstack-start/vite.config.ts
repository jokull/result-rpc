import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackStart(), react()],
  resolve: {
    // `result-rpc` is linked with `file:../..`, so its files live outside
    // this package root and could pull a second React copy. Two Reacts =
    // silently broken hooks.
    dedupe: ["react", "react-dom"],
  },
  ssr: {
    // Native driver: never bundle it into a server environment.
    external: ["better-sqlite3"],
  },
});

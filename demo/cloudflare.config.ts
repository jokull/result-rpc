import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "result-rpc-demo",
    compatibilityDate: "2026-07-28",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "./worker/index.ts",
    domains: ["demo.result-rpc.com"],
    env: {
      DB: bindings.d1({
        name: "result-rpc-demo",
        id: "caedc918-a787-468f-b668-9f6386f5f91d",
      }),
      ASSETS: bindings.assets(),
    },
  },
});

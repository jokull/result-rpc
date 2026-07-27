/**
 * The router entry TanStack Start requires (`src/router.tsx`, exporting
 * `getRouter`). It is called once per SSR request on the server and once
 * on hydration in the browser.
 */
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

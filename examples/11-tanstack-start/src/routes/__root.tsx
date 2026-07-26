/**
 * Root route: the document shell plus the ONE client runtime.
 *
 * `ResultRpcProvider` lives here, above every route, so a hydration
 * boundary in any route's component merges into the same runtime — the
 * direct analogue of the RSC examples' root layout.
 */
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ResultRpcProvider } from "result-rpc/react";
import { client } from "../rpc-client.js";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Spots — result-rpc × TanStack Start" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  errorComponent: ({ error }) => (
    <p role="alert" className="error">
      Broken: {(error as { _tag?: string })._tag ?? error.message}
    </p>
  ),
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  return (
    <ResultRpcProvider client={client}>
      <header className="site-header">
        <Link to="/" className="brand">
          ⛩️ Spots
        </Link>
        <span className="subtitle">
          result-rpc kitchen sink on TanStack Start SSR
        </span>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        Prefetched in a route <code>loader</code>, hydrated by{" "}
        <code>ResultRpcHydrationBoundary</code>, patched by entity identity.
      </footer>
    </ResultRpcProvider>
  );
}

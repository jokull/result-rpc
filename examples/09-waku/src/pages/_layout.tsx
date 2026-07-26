/**
 * Static root layout: prerendered at build/startup, so it must not touch
 * the database. It owns the client boundary (Providers → ResultRpcProvider)
 * and the nav; dynamic pages below render into `children`.
 */
import type { ReactNode } from "react";
import { Link } from "waku";
import "../styles.css";
import { Providers } from "../components/providers.js";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <header className="site-header">
        <Link to="/" className="brand">
          ⛩️ Spots
        </Link>
        <span className="subtitle">result-rpc kitchen sink on Waku RSC</span>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        Server-prefetched, hydrated by <code>ResultRpcHydrationBoundary</code>, patched by
        entity identity.
      </footer>
    </Providers>
  );
}

export const getConfig = async () => {
  return { render: "static" } as const;
};

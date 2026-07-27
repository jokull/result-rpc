/**
 * Root layout — a SERVER component. It touches no database, so it stays
 * cheap and cacheable; its only job is to own the single client boundary
 * (Providers → ResultRpcProvider) that every hydration boundary below
 * merges into.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Providers } from "../src/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spots — result-rpc × Next.js",
  description: "result-rpc kitchen sink on the Next.js 16 App Router",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="site-header">
            <Link href="/" className="brand">
              ⛩️ Spots
            </Link>
            <span className="subtitle">result-rpc kitchen sink on Next.js 16 RSC</span>
          </header>
          <main>{children}</main>
          <footer className="site-footer">
            Server-prefetched, hydrated by <code>ResultRpcHydrationBoundary</code>, patched
            by entity identity.
          </footer>
        </Providers>
      </body>
    </html>
  );
}

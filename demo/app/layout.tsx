import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://demo.result-rpc.com"),
  title: "Ticket cache demo · result-rpc",
  description:
    "A live result-rpc showcase for optimistic updates, entity identity, cursor pagination, and invalidation.",
  openGraph: {
    title: "See result-rpc keep a ticket app coherent",
    description:
      "Optimistic updates, entity patches, cursor pagination, and explicit invalidation—live against D1.",
    url: "https://demo.result-rpc.com",
    siteName: "result-rpc demo",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "result-rpc ticket cache demo",
    description: "Watch entity patches and invalidation happen over a real RPC wire.",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#2e5090",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}

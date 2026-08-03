import { defineConfig } from "blume";
import type { AstroIntegration } from "astro";

/**
 * The repo root carries its own `react` devDependency (the library's tests run
 * on it) and this site is nested inside that repo, so Vite can end up with two
 * Reacts — one for the Astro renderer, one for anything under `src/` — and
 * every island dies on `Invalid hook call`. `dedupe` collapses them.
 *
 * Aliasing to resolved entry paths instead does not work: it bypasses the
 * package's export conditions and hands the CJS build to the SSR runner, which
 * fails with `module is not defined`.
 */
const dedupeReact: AstroIntegration = {
  name: "result-rpc-dedupe-react",
  hooks: {
    "astro:config:setup": ({ updateConfig }) => {
      updateConfig({
        vite: {
          resolve: { dedupe: ["react", "react-dom"] },
          // Declared up front so the optimizer does not discover `motion`
          // mid-session, re-optimize, and leave the page holding modules from
          // two different pre-bundles — which presents as the same duplicate
          // React error.
          optimizeDeps: { include: ["motion/react"] },
        },
      });
    },
  },
};

export default defineConfig({
  title: "result-rpc",
  description:
    "Typed RPC for React. Errors accumulate along the call path and discharge along the component tree.",
  logo: {
    href: "/",
    image: "/result-rpc-lockup-blue.svg",
    text: "",
  },
  github: {
    owner: "jokull",
    repo: "result-rpc",
    dir: "website",
  },
  content: {
    root: "src/content/docs",
    pages: "src/pages",
  },
  navigation: {
    sidebar: [
      {
        label: "Start here",
        items: ["/start/agents", "/start/introduction", "/start/installation", "/start/quickstart"],
      },
      {
        label: "The contract",
        items: [
          "/concepts/errors",
          "/concepts/results",
          "/concepts/contract",
          "/concepts/context",
          "/concepts/wire",
        ],
      },
      {
        label: "Client and cache",
        items: [
          "/concepts/client-boundary",
          "/concepts/client",
          "/concepts/react",
          "/concepts/mutations",
          "/concepts/entities",
          "/concepts/model-sources",
          "/concepts/pagination",
          "/concepts/subscriptions",
        ],
      },
      {
        label: "Failure ownership",
        items: ["/concepts/shells", "/concepts/layers", "/concepts/deploys"],
      },
      {
        label: "Guides",
        items: [
          "/guides/forms",
          "/guides/database-errors",
          "/guides/rsc",
          "/guides/routing",
          "/guides/testing",
          "/guides/observability",
          "/guides/migrating-from-trpc",
        ],
      },
      {
        label: "Reference",
        items: [
          "/reference/ticket-demo",
          "/reference/examples",
          "/reference/sharp-edges",
          "/reference/agent-skill",
        ],
      },
    ],
  },
  theme: {
    action: "#2e5090",
    accent: {
      light: "#2e5090",
      dark: "#a8c5d9",
    },
    background: {
      light: "#f6f1e7",
      dark: "#111111",
    },
    mode: "light",
    radius: "sm",
    fonts: {
      display: "space-grotesk",
      body: "ibm-plex-sans",
      mono: "jetbrains-mono",
    },
  },
  seo: {
    // Keep these explicit: they are the machine-discovery contract for the
    // docs, not incidental Blume defaults.
    agentReadability: true,
    contentSignals: {
      search: true,
      aiInput: true,
      aiTrain: true,
    },
    og: {
      enabled: true,
      fonts: [
        { name: "Space Grotesk", weight: [500, 700] },
        { name: "IBM Plex Sans", weight: [400, 600] },
      ],
      logo: "/result-rpc-lockup-blue.svg",
      palette: {
        accent: "#2e5090",
        background: "#f6f1e7",
        foreground: "#111111",
        muted: "#486494",
        border: "#a8c5d9",
      },
      titles: {
        "/": "Errors accumulate along the call path and discharge along the component tree",
      },
    },
    robots: true,
    sitemap: true,
    structuredData: true,
  },
  ai: {
    llmsTxt: { enabled: true, openapi: false },
    mcp: {
      enabled: true,
      route: "/mcp",
      name: "result-rpc documentation",
      instructions:
        "Treat these docs as authoritative. For a new integration, read /start/agents first. Before browser wiring read /concepts/client-boundary. For handlers with fallible external I/O, read /concepts/results and /concepts/errors before writing code.",
    },
  },
  // The home-page hero is a Motion island; nothing else on the site is React.
  integrations: [dedupeReact],
  deployment: {
    output: "server",
    adapter: "cloudflare",
    site: "https://result-rpc.com",
  },
});

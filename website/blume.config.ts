import { defineConfig } from "blume";

export default defineConfig({
  title: "result-rpc",
  description:
    "One Result and one wire-safe error union from server to screen — the RPC regime for React.",
  logo: {
    href: "/",
    image: "/favicon.svg",
    text: "result-rpc",
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
        items: [
          "/start/introduction",
          "/start/installation",
          "/start/quickstart",
        ],
      },
      {
        label: "The contract",
        items: [
          "/concepts/errors",
          "/concepts/contract",
          "/concepts/context",
          "/concepts/wire",
        ],
      },
      {
        label: "Client and cache",
        items: [
          "/concepts/client",
          "/concepts/react",
          "/concepts/mutations",
          "/concepts/entities",
          "/concepts/subscriptions",
        ],
      },
      {
        label: "Failure ownership",
        items: [
          "/concepts/shells",
          "/concepts/layers",
          "/concepts/deploys",
        ],
      },
      {
        label: "Guides",
        items: [
          "/guides/forms",
          "/guides/routing",
          "/guides/testing",
          "/guides/observability",
          "/guides/migrating-from-trpc",
        ],
      },
      {
        label: "Reference",
        items: [
          "/reference/examples",
          "/reference/sharp-edges",
        ],
      },
    ],
  },
  theme: {
    accent: {
      light: "#4056c8",
      dark: "#9caeff",
    },
    background: {
      light: "#fbfbfd",
      dark: "#10131a",
    },
    fonts: {
      body: "inter",
      display: "source-serif-4",
      mono: "ibm-plex-mono",
    },
    mode: "system",
    radius: "sm",
  },
  seo: {
    og: {
      enabled: true,
      logo: "/favicon.svg",
      palette: {
        accent: "#9caeff",
        background: "#1a2030",
        foreground: "#f2f4fb",
        muted: "#aeb6cc",
        border: "#3c4763",
      },
      titles: {
        "/": "One Result. One error union. Server to screen.",
      },
    },
    robots: true,
    sitemap: true,
    structuredData: true,
  },
  ai: {
    llmsTxt: true,
  },
  deployment: {
    output: "static",
    site: "https://result-rpc.solberg.is",
  },
});

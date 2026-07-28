import { defineConfig } from "blume";

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
        items: ["/start/introduction", "/start/installation", "/start/quickstart"],
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
          "/guides/drizzle",
          "/guides/rsc",
          "/guides/routing",
          "/guides/testing",
          "/guides/observability",
          "/guides/migrating-from-trpc",
        ],
      },
      {
        label: "Reference",
        items: ["/reference/examples", "/reference/sharp-edges", "/reference/agent-skill"],
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
    llmsTxt: true,
  },
  deployment: {
    output: "static",
    site: "https://result-rpc.com",
  },
});

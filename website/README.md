# result-rpc documentation site

Built with [Blume](https://useblume.dev/) — same stack as onwardpg's docs.
Content lives in `src/content/docs/`; the landing page in `src/pages/`.
The Space Grotesk / IBM Plex Sans / JetBrains Mono system and shared color
roles live in `theme.css` and `blume.config.ts`. The direct-path Iris wordmark,
favicons, and home OG asset live under `public/`.

```sh
pnpm install
pnpm dev
pnpm check      # type-check pages, strict
pnpm validate   # broken-link check
pnpm build      # static output to dist/
```

Deploy `dist/` to Cloudflare Workers Assets (`wrangler deploy`); the configured
primary custom domain is `result-rpc.com`. A separate Worker configured by
`wrangler.redirect.jsonc` permanently redirects `result-rpc.solberg.is` to the
same path and query on the primary domain.

The docs pages were seeded from README.md section-for-section. When the README
changes materially, port the change here (or restructure the README to point at
the site — an open decision).

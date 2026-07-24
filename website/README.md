# result-rpc documentation site

Built with [Blume](https://useblume.dev/) — same stack as onwardpg's docs.
Content lives in `src/content/docs/`; the landing page in `src/pages/`.

```sh
pnpm install
pnpm dev
pnpm check      # type-check pages, strict
pnpm validate   # broken-link check
pnpm build      # static output to dist/
```

Deploy `dist/` to Cloudflare Workers Assets (`wrangler deploy`); the configured
custom domain is `result-rpc.solberg.is`.

The docs pages were seeded from README.md section-for-section. When the README
changes materially, port the change here (or restructure the README to point at
the site — an open decision).

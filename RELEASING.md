# Releasing result-rpc

Releases are tag-driven and publish one previously verified tarball. A version
with a prerelease suffix such as `0.1.0-rc.1` goes to npm's `next` channel. A
stable version goes to `latest`.

## One-time repository setup

1. In GitHub, configure the `npm` environment with required reviewer approval
   and restrict it to tags matching `v*`.
2. In the npm package settings, add a trusted GitHub Actions publisher:
   - organization or user: `jokull`
   - repository: `result-rpc`
   - workflow: `release.yml`
   - environment: `npm`
   - allowed action: `npm publish`
3. Revoke any write-capable npm automation token after the trusted publisher is
   active. The workflow deliberately has no `NODE_AUTH_TOKEN`.

Trusted publishing requires npm 11.5.1 or newer and Node 22.14 or newer. The
release job pins the current security release, Node 24.18.1 with npm 11.12.1,
grants only `contents: read` and
`id-token: write`, disables dependency caching, and publishes from a
GitHub-hosted runner. npm generates provenance from that OIDC identity.

If npm requires the package to exist before its trusted publisher can be
configured, bootstrap the package once with a short-lived granular token,
configure the trusted publisher immediately, then revoke the token. Do not add
that token to this workflow.

## Cut a prerelease

Choose the version explicitly so the package, commit, and tag remain easy to
audit:

```bash
pnpm version 0.1.0-rc.1 --no-git-tag-version
pnpm verify:release
git add package.json pnpm-lock.yaml
git commit -m "Release 0.1.0-rc.1"
git tag -a v0.1.0-rc.1 -m "result-rpc 0.1.0-rc.1"
git push origin main
git push origin v0.1.0-rc.1
```

Use `git tag -s` instead when the release machine has a configured signing key.
The tag workflow checks that the tag is exactly `v<package.version>`, reruns the
complete release gate, packs once, uploads that tarball as a GitHub Actions
artifact, and publishes the same bytes to npm under `next`.

## Promote a stable version

Set a version without a prerelease suffix and repeat the same signed-tag flow.
The workflow selects `latest` automatically. It will never infer or alter the
package version.

## Gates

- Pull requests and `main` run packed-consumer checks on Node 20.19.5.
- Node 24 runs the complete source, declaration, diagnostics, package,
  React 18/19, Vite, Worker, Next RSC, entity-performance, type-scaling, demo,
  and documentation matrix.
- Every successful `main` run uploads the reviewed `.tgz` for 14 days.
- A release reruns the matrix from the tag without dependency caches and
  requires approval from the protected `npm` environment.

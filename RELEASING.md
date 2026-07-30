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

## Changesets, for versioning only

Every user-visible change carries a file in `.changeset/`, written in the pull
request that makes the change — `pnpm changeset`, or hand-written markdown.
`.changeset/README.md` has the conventions, including the bump levels to use
while the package is below `1.0.0`.

`changeset publish` is deliberately **not** wired up, and must not be. Changesets
computes the version and writes `CHANGELOG.md`; the tag still decides what
publishes, and it is still signed by a human. Only two commands are used:

```bash
pnpm changeset:status    # what would be released, and at what bump
pnpm changeset:version   # consume .changeset/*, bump package.json, write CHANGELOG.md
```

Nothing forces the version and the changelog to agree afterwards, so
`pnpm release:check` verifies it: it refuses a tag whose version has no
`## <version>` heading in `CHANGELOG.md`, and refuses any release with
unconsumed changesets still in the folder. Both would otherwise fail silently —
the release ships, and the changelog simply does not mention it.

## Cut a release

`changeset:version` computes the version from the accumulated changesets, so it
is chosen by the changes rather than by hand. Read what it picked before
tagging:

```bash
pnpm changeset:version
git diff package.json CHANGELOG.md   # confirm the version and the entry
pnpm verify:release
pnpm release:check v0.2.0

git add package.json pnpm-lock.yaml CHANGELOG.md .changeset
git commit -m "Release 0.2.0"
git tag -a v0.2.0 -m "result-rpc 0.2.0"
git push origin main
git push origin v0.2.0
```

Use `git tag -s` instead when the release machine has a configured signing key.
The tag workflow checks that the tag is exactly `v<package.version>`, reruns the
complete release gate, packs once, uploads that tarball as a GitHub Actions
artifact, and publishes the same bytes to npm. A version with a prerelease
suffix goes to `next`; a stable version goes to `latest`. The workflow never
infers or alters the package version.

## Cut a prerelease

Changesets has a prerelease mode that produces `0.2.0-rc.0`, `-rc.1`, and so on
from the same accumulated changesets, and keeps them accumulated for the
eventual stable release:

```bash
pnpm changeset pre enter rc
pnpm changeset:version           # 0.2.0-rc.0
# … tag and publish as above; repeat changeset:version for each further rc
pnpm changeset pre exit
pnpm changeset:version           # 0.2.0
```

`pre exit` before the stable release is not optional: skipping it ships a
version still carrying the `-rc` suffix, which lands on `next` rather than
`latest`. The `.changeset/pre.json` that `pre enter` writes is committed, so
the mode is visible in the tree rather than remembered.

To set a version by hand instead — a security patch on an old line, say —
`pnpm version <v> --no-git-tag-version` and add the `CHANGELOG.md` entry
yourself. `release:check` enforces that the entry exists.

## Gates

- Pull requests and `main` run packed-consumer checks on Node 20.19.5.
- Node 24 runs the complete source, declaration, diagnostics, package,
  React 18/19, Vite, Worker, Next RSC, entity-performance, type-scaling, demo,
  and documentation matrix.
- Every successful `main` run uploads the reviewed `.tgz` for 14 days.
- A release reruns the matrix from the tag without dependency caches and
  requires approval from the protected `npm` environment.

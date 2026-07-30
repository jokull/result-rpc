# Changesets

Every user-visible change gets a file in this folder, written in the same pull
request as the change. `pnpm changeset` creates one interactively; writing the
markdown by hand is equally fine.

The point is that the person who knows what broke and why is the one holding
the keyboard. A changelog assembled at release time is assembled by whoever is
cutting the release, from commit subjects, days later.

**Bump levels while the package is below 1.0.0.** Changesets applies plain
semver, so a `major` changeset would take `0.x` to `1.0.0`. It does not know
about the 0.x convention. So until 1.0.0:

| Change              | Level   |
| ------------------- | ------- |
| Breaking            | `minor` |
| Added, non-breaking | `minor` |
| Fixed, internal     | `patch` |

Because breaking and additive share a level, the section heading cannot carry
the severity. **Start a breaking summary with `**Breaking:** `** so it is
visible in the rendered changelog.

Write the summary for someone upgrading: what changed, why, and the diff they
need to apply. It is published to npm and read out of context.

result-rpc uses Changesets for **versioning only**. `changeset publish` is not
wired up and must not be: releases are a signed tag, and the tag workflow
publishes one previously verified tarball. See `RELEASING.md`.

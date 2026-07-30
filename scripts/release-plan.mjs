const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Version-only Changesets: `changeset version` bumps and writes the changelog,
 * and a human signs the tag. Nothing forces those two to agree, so this is the
 * check that they did. Both failures are silent otherwise — the release ships,
 * and the changelog simply does not mention it.
 *
 * @param version the version about to be published
 * @param changelog the text of CHANGELOG.md
 * @param pendingChangesets basenames of unconsumed `.changeset/*.md` files
 */
export function assertReleaseIsDocumented(version, changelog, pendingChangesets) {
  if (pendingChangesets.length > 0) {
    throw new TypeError(
      `Unconsumed changesets at release time: ${pendingChangesets.join(", ")}. ` +
        "Run `pnpm changeset:version` before tagging.",
    );
  }
  // A heading, not a substring: `0.2.0` also occurs inside `0.2.0-rc.1`.
  if (!new RegExp(`^## ${version.replace(/[.+]/g, "\\$&")}$`, "m").test(changelog)) {
    throw new TypeError(`CHANGELOG.md has no \`## ${version}\` entry for this release`);
  }
}

export function releasePlan(packageJson, tag) {
  const match = semver.exec(packageJson.version);
  if (!match) {
    throw new TypeError(`package.json contains an invalid version: ${packageJson.version}`);
  }
  if (!tag) {
    throw new TypeError("Pass a release tag or run from a GitHub tag workflow");
  }

  const expectedTag = `v${packageJson.version}`;
  if (tag !== expectedTag) {
    throw new TypeError(`Release tag ${tag} does not match package version ${expectedTag}`);
  }
  if (packageJson.private === true) {
    throw new TypeError("The release package cannot be private");
  }
  if (packageJson.name !== "result-rpc") {
    throw new TypeError(`Unexpected release package name: ${packageJson.name}`);
  }
  if (packageJson.repository?.url !== "git+https://github.com/jokull/result-rpc.git") {
    throw new TypeError("package.json repository must exactly match the trusted GitHub repository");
  }

  const prerelease = match[4] !== undefined;
  return {
    version: packageJson.version,
    dist_tag: prerelease ? "next" : "latest",
    prerelease: String(prerelease),
  };
}

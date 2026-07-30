const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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

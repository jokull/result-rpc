import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReleaseIsDocumented, releasePlan } from "./release-plan.mjs";

const manifest = (version) => ({
  name: "result-rpc",
  version,
  repository: {
    url: "git+https://github.com/jokull/result-rpc.git",
  },
});

test("stable versions publish to latest", () => {
  assert.deepEqual(releasePlan(manifest("0.1.0"), "v0.1.0"), {
    version: "0.1.0",
    dist_tag: "latest",
    prerelease: "false",
  });
});

test("prerelease versions publish to next", () => {
  assert.deepEqual(releasePlan(manifest("0.1.0-rc.2"), "v0.1.0-rc.2"), {
    version: "0.1.0-rc.2",
    dist_tag: "next",
    prerelease: "true",
  });
});

test("a tag can never select a different package version", () => {
  assert.throws(
    () => releasePlan(manifest("0.1.0-rc.2"), "v0.1.0"),
    /does not match package version/,
  );
});

test("invalid versions and package identities fail before publishing", () => {
  assert.throws(() => releasePlan(manifest("banana"), "vbanana"), /invalid version/);
  assert.throws(
    () => releasePlan({ ...manifest("0.1.0"), name: "other" }, "v0.1.0"),
    /Unexpected release package name/,
  );
});

const changelog = ["# result-rpc", "", "## 0.2.0", "", "### Minor Changes", ""].join("\n");

test("a release must be documented in the changelog", () => {
  assert.doesNotThrow(() => assertReleaseIsDocumented("0.2.0", changelog, []));
  assert.throws(() => assertReleaseIsDocumented("0.3.0", changelog, []), /no `## 0.3.0` entry/);
});

test("a prerelease is not satisfied by its own stable heading", () => {
  // `0.2.0-rc.1` contains `0.2.0`, so a substring test would pass here.
  assert.throws(
    () => assertReleaseIsDocumented("0.2.0-rc.1", changelog, []),
    /no `## 0.2.0-rc.1` entry/,
  );
});

test("unconsumed changesets block a release", () => {
  assert.throws(
    () => assertReleaseIsDocumented("0.2.0", changelog, ["wire-nullable.md"]),
    /Unconsumed changesets at release time: wire-nullable\.md/,
  );
});

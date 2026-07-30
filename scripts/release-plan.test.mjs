import assert from "node:assert/strict";
import { test } from "node:test";
import { releasePlan } from "./release-plan.mjs";

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

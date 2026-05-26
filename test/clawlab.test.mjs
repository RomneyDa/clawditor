import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("clawlab cli", () => {
  it("prints help successfully", () => {
    const output = execFileSync("node", ["bin/clawlab.mjs", "--help"], {
      encoding: "utf8",
    });
    assert.match(output, /clawlab beta --package openclaw@beta/u);
  });

  it("builds a dry-run github plan", () => {
    const output = execFileSync("node", [
      "bin/clawlab.mjs",
      "beta",
      "--package",
      "openclaw@beta",
      "--profile",
      "smoke",
      "--suite",
      "github",
      "--dry-run",
      "--no-dedupe",
      "--json",
    ], { encoding: "utf8" });
    const summary = JSON.parse(output);
    assert.equal(summary.candidate.label, "openclaw@beta");
    assert.ok(summary.github.some((run) => run.workflow === "package-acceptance.yml"));
    assert.equal(summary.verdict, "DRY_RUN");
  });

  it("builds a dry-run downloadable plan without a repo checkout", () => {
    const output = execFileSync("node", [
      "bin/clawlab.mjs",
      "beta",
      "--package",
      "openclaw@beta",
      "--profile",
      "smoke",
      "--suite",
      "download",
      "--dry-run",
      "--json",
    ], { encoding: "utf8" });
    const summary = JSON.parse(output);
    assert.equal(summary.preflight.openclawHead, "downloadable/github mode");
    assert.ok(summary.download.some((run) => run.lane === "package-smoke"));
    assert.equal(summary.verdict, "DRY_RUN");
  });
});

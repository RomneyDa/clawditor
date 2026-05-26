import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("clawlab cli", () => {
  it("prints help successfully", () => {
    const output = execFileSync("node", ["bin/clawlab.mjs", "--help"], {
      encoding: "utf8",
    });
    assert.match(output, /clawlab test openclaw@beta/u);
  });

  it("builds a dry-run remote github plan", () => {
    const output = execFileSync("node", [
      "bin/clawlab.mjs",
      "test",
      "openclaw@beta",
      "--profile",
      "smoke",
      "--remote",
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
      "test",
      "openclaw@beta",
      "--profile",
      "smoke",
      "--dry-run",
      "--json",
    ], { encoding: "utf8" });
    const summary = JSON.parse(output);
    assert.equal(summary.preflight.openclawHead, "downloadable/github mode");
    assert.equal(summary.github.length, 0);
    assert.ok(summary.download.some((run) => run.lane === "package-smoke"));
    assert.equal(summary.verdict, "DRY_RUN");
  });

  it("uses standard as a meaningful default profile", () => {
    const output = execFileSync("node", [
      "bin/clawlab.mjs",
      "test",
      "openclaw@beta",
      "--dry-run",
      "--json",
    ], { encoding: "utf8" });
    const summary = JSON.parse(output);
    assert.equal(summary.profile, "standard");
    assert.deepEqual(
      summary.download.map((run) => run.lane),
      ["package-smoke", "cli-smoke", "crabpot"],
    );
    assert.equal(summary.github.length, 0);
  });
});

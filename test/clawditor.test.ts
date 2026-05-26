import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("clawditor cli", () => {
  it("prints help successfully", () => {
    const output = execFileSync("node", ["dist/clawditor.js", "--help"], {
      encoding: "utf8",
    });
    assert.match(output, /clawditor test openclaw@beta/u);
  });

  it("builds a dry-run remote github plan", () => {
    const output = execFileSync("node", [
      "dist/clawditor.js",
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

  it("builds a dry-run package/cache plan without a repo checkout", () => {
    const output = execFileSync("node", [
      "dist/clawditor.js",
      "test",
      "openclaw@beta",
      "--profile",
      "smoke",
      "--dry-run",
      "--json",
    ], { encoding: "utf8" });
    const summary = JSON.parse(output);
    assert.equal(summary.preflight.openclawHead, "local package/cache mode");
    assert.equal(summary.github.length, 0);
    assert.ok(summary.download.some((run) => run.lane === "package-smoke"));
    assert.equal(summary.verdict, "DRY_RUN");
  });

  it("uses standard as a meaningful default profile", () => {
    const output = execFileSync("node", [
      "dist/clawditor.js",
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

  it("includes crabbox and crabpot in the default suites using cached checkouts", () => {
    const output = execFileSync("node", [
      "dist/clawditor.js",
      "test",
      "openclaw@beta",
      "--dry-run",
      "--json",
    ], { encoding: "utf8" });
    const summary = JSON.parse(output);
    assert.ok(summary.crabbox.length > 0, "crabbox suite ran by default");
    assert.ok(summary.crabbox.every((run) => run.action === "dry-run"));
    assert.ok(summary.crabpot, "crabpot suite ran by default");
    assert.ok(summary.crabbox[0].command.includes("/repos/openclaw-suite/"));
    assert.equal(summary.verdict, "DRY_RUN");
  });

  it("uses a local-build Kova target for the default diagnostic profile", () => {
    const output = execFileSync("node", [
      "dist/clawditor.js",
      "test",
      "openclaw@beta",
      "--dry-run",
      "--json",
    ], { encoding: "utf8" });
    const summary = JSON.parse(output);
    assert.equal(summary.kova.profile, "diagnostic");
    assert.match(summary.kova.command, /kova_target="local-build:/u);
    assert.match(summary.kova.command, /pnpm --dir "\$openclaw_target_repo" install --frozen-lockfile/u);
    assert.doesNotMatch(summary.kova.command, /kova_target="npm:/u);
  });
});

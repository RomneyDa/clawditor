#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const githubRepo = "openclaw/openclaw";

const profiles = {
  smoke: {
    releaseProfile: "beta",
    runFullRelease: false,
    packageAcceptanceProfile: "smoke",
    kovaProfile: "smoke",
    kovaRepeat: "1",
    downloadLanes: ["package-smoke"],
  },
  standard: {
    releaseProfile: "beta",
    runFullRelease: true,
    packageAcceptanceProfile: "package",
    kovaProfile: "diagnostic",
    kovaRepeat: "3",
    downloadLanes: ["package-smoke", "cli-smoke", "crabpot"],
  },
  full: {
    releaseProfile: "full",
    runFullRelease: true,
    packageAcceptanceProfile: "full",
    kovaProfile: "release",
    kovaRepeat: "3",
    downloadLanes: ["package-smoke", "cli-smoke", "crabpot", "prompt-pack"],
  },
};

const defaultSuites = new Set(["download", "prompts"]);

function usage() {
  return `Usage:
  clawlab test openclaw@beta [options]
  clawlab test --ref release/2026.5.26 [options]

Options:
  --profile smoke|standard|full       Coverage profile (default: standard)
  --repo <path>                       Optional local OpenClaw checkout for dev-only local-crabbox lanes
  --crabpot <path>                    Optional local Crabpot checkout for dev-only local-crabpot lanes
  --output <path>                     Artifact root (default: .artifacts)
  --suite <names>                     Comma list: github,download,crabbox,crabpot,prompts
  --github-mode umbrella|separate     Workflow strategy (default: umbrella)
  --remote                            Add GitHub workflow dispatch/reuse
  --force-workflows                   Start workflows even when active runs exist
  --no-dedupe                         Disable active-run dedupe checks
  --watch                             Poll GitHub workflows after launching
  --dry-run                           Print actions without starting them
  --json                              Print final summary JSON
  --help                              Show this help
`;
}

function parseArgs(argv) {
  const defaults = defaultPaths();
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return {
      command: argv[0] ?? "",
      help: true,
      profile: "standard",
      openclawRoot: null,
      crabpotRoot: null,
      outputRoot: defaults.outputRoot,
      githubMode: "umbrella",
      forceWorkflows: false,
      dedupe: true,
      watch: false,
      dryRun: false,
      json: false,
      suites: new Set(defaultSuites),
    };
  }
  const [command, ...rest] = argv;
  const positional = [];
  const options = {
    command,
    profile: "standard",
    openclawRoot: null,
    crabpotRoot: null,
    outputRoot: defaults.outputRoot,
    githubMode: "umbrella",
    forceWorkflows: false,
    dedupe: true,
    watch: false,
    dryRun: false,
    json: false,
    suites: new Set(defaultSuites),
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = () => {
      const value = rest[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      i += 1;
      return value;
    };

    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--ref") options.ref = next();
    else if (arg === "--profile") options.profile = next();
    else if (arg === "--repo") options.openclawRoot = resolve(next());
    else if (arg === "--crabpot") options.crabpotRoot = resolve(next());
    else if (arg === "--output") options.outputRoot = resolve(next());
    else if (arg === "--suite") options.suites = new Set(next().split(",").map((item) => item.trim()).filter(Boolean));
    else if (arg === "--github-mode") options.githubMode = next();
    else if (arg === "--remote" || arg === "--github") options.suites.add("github");
    else if (arg === "--force-workflows") options.forceWorkflows = true;
    else if (arg === "--no-dedupe") options.dedupe = false;
    else if (arg === "--watch") options.watch = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option: ${arg}`);
    else positional.push(arg);
  }

  if (positional.length > 1) {
    throw new Error(`unexpected argument: ${positional[1]}`);
  }
  if (positional.length > 0 && !options.ref) {
    options.packageSpec = positional[0];
  } else if (positional.length > 0 && options.ref) {
    throw new Error("choose either a package argument or --ref, not both");
  } else if (positional.length > 0) {
    throw new Error(`unexpected argument: ${positional[0]}`);
  }

  return options;
}

function defaultPaths() {
  return {
    outputRoot: resolve(process.cwd(), ".artifacts"),
  };
}

function isOpenclawRepo(path) {
  return existsSync(resolve(path, "package.json")) &&
    existsSync(resolve(path, "scripts/crabbox-wrapper.mjs")) &&
    existsSync(resolve(path, ".github/workflows/full-release-validation.yml"));
}

function isCrabpotRepo(path) {
  return existsSync(resolve(path, "package.json")) &&
    existsSync(resolve(path, "crabpot.config.json")) &&
    existsSync(resolve(path, "scripts/run-static-suite.mjs"));
}

function runSync(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !opts.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
  return result;
}

function commandExists(command) {
  return spawnSync("sh", ["-lc", `command -v ${quote(command)} >/dev/null 2>&1`]).status === 0;
}

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function readJsonCommand(command, args, cwd) {
  const result = runSync(command, args, { cwd, capture: true, allowFailure: true });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout || "null");
  } catch {
    return null;
  }
}

function preflight(options) {
  const missing = [];
  const required = ["node"];
  if (options.suites.has("github")) required.push("gh");
  if (options.suites.has("download")) required.push("npm", "npx");
  if (options.suites.has("download") || options.suites.has("crabbox") || options.suites.has("crabpot")) {
    required.push("git");
  }
  for (const command of required) {
    if (!commandExists(command)) missing.push(command);
  }
  if (options.suites.has("crabbox")) {
    if (!commandExists("pnpm")) missing.push("pnpm");
    if (!options.openclawRoot) {
      throw new Error("--suite crabbox requires --repo <local-openclaw-checkout>");
    }
    if (!isOpenclawRepo(options.openclawRoot)) {
      throw new Error(`--repo is not an OpenClaw checkout: ${options.openclawRoot}`);
    }
  }
  if (options.suites.has("crabpot")) {
    if (!options.crabpotRoot) {
      throw new Error("--suite crabpot requires --crabpot <local-crabpot-checkout>");
    }
    if (!isCrabpotRepo(options.crabpotRoot)) {
      throw new Error(`--crabpot is not a Crabpot checkout: ${options.crabpotRoot}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`missing required command(s): ${missing.join(", ")}`);
  }

  const openclaw = options.openclawRoot
    ? localGitInfo(options.openclawRoot)
    : { status: "not required", head: "downloadable/github mode" };

  return {
    openclawStatus: openclaw.status,
    openclawHead: openclaw.head,
    openclawRoot: options.openclawRoot,
    crabpotRoot: options.crabpotRoot,
    crabboxWrapper: options.openclawRoot ? resolve(options.openclawRoot, "scripts/crabbox-wrapper.mjs") : null,
  };
}

function localGitInfo(cwd) {
  const status = runSync("git", ["status", "-sb"], {
    cwd,
    capture: true,
    allowFailure: true,
  });
  const head = runSync("git", ["rev-parse", "HEAD"], {
    cwd,
    capture: true,
    allowFailure: true,
  });
  return {
    status: status.stdout.trim(),
    head: head.stdout.trim(),
  };
}

function candidateFromOptions(options) {
  if (options.packageSpec) {
    return {
      kind: "package",
      label: options.packageSpec,
      workflowRef: "main",
      targetRef: "main",
    };
  }
  if (options.ref) {
    return {
      kind: "ref",
      label: options.ref,
      workflowRef: "main",
      targetRef: options.ref,
    };
  }
  throw new Error("missing candidate: pass a package spec such as openclaw@beta or --ref <branch/tag/sha>");
}

function workflowInputs(workflow, candidate, profile) {
  if (workflow === "full-release-validation.yml") {
    const inputs = {
      ref: candidate.targetRef,
      provider: "openai",
      mode: "both",
      release_profile: profile.releaseProfile,
      rerun_group: "all",
    };
    if (candidate.kind === "package") {
      inputs.release_package_spec = candidate.label;
      inputs.package_acceptance_package_spec = candidate.label;
      inputs.npm_telegram_package_spec = candidate.label;
    }
    if (profile.releaseProfile === "full") {
      inputs.run_release_soak = "true";
    }
    return inputs;
  }

  if (workflow === "package-acceptance.yml") {
    const inputs = {
      workflow_ref: "main",
      source: candidate.kind === "package" ? "npm" : "ref",
      package_ref: candidate.kind === "ref" ? candidate.targetRef : "main",
      package_spec: candidate.kind === "package" ? candidate.label : "",
      suite_profile: profile.packageAcceptanceProfile,
      telegram_mode: "mock-openai",
    };
    return inputs;
  }

  if (workflow === "plugin-prerelease.yml") {
    return {
      target_ref: candidate.targetRef,
      full_release_validation: "true",
    };
  }

  if (workflow === "openclaw-performance.yml") {
    return {
      target_ref: candidate.targetRef,
      profile: profile.kovaProfile,
      repeat: profile.kovaRepeat,
      deep_profile: profile.releaseProfile === "full" ? "true" : "false",
      live_openai_candidate: "false",
    };
  }

  throw new Error(`unknown workflow: ${workflow}`);
}

function workflowPlan(options, candidate, profile) {
  if (!options.suites.has("github")) return [];
  if (options.githubMode === "umbrella" && profile.runFullRelease) {
    return ["full-release-validation.yml"];
  }
  return ["package-acceptance.yml", "plugin-prerelease.yml", "openclaw-performance.yml"];
}

function activeWorkflowRun(workflow, options) {
  if (!options.dedupe || options.forceWorkflows) return null;
  const fields = "databaseId,displayTitle,event,headBranch,status,conclusion,createdAt,url,workflowName";
  const active = [];
  for (const status of ["queued", "in_progress", "waiting", "requested", "pending"]) {
    const runs = readJsonCommand("gh", [
      "run",
      "list",
      "--repo",
      githubRepo,
      "--workflow",
      workflow,
      "--status",
      status,
      "--limit",
      "20",
      "--json",
      fields,
    ]);
    if (Array.isArray(runs)) active.push(...runs);
  }
  return active.find((run) => run.event === "workflow_dispatch") ?? null;
}

function launchWorkflow(workflow, candidate, profile, options) {
  const existing = activeWorkflowRun(workflow, options);
  if (existing) {
    return {
      type: "github",
      workflow,
      action: "reuse-active",
      id: existing.databaseId,
      url: existing.url,
      status: existing.status,
    };
  }

  const inputs = workflowInputs(workflow, candidate, profile);
  const args = ["workflow", "run", workflow, "--repo", githubRepo, "--ref", candidate.workflowRef];
  for (const [key, value] of Object.entries(inputs)) {
    if (value !== undefined && value !== "") {
      args.push("-f", `${key}=${value}`);
    }
  }

  if (options.dryRun) {
    return { type: "github", workflow, action: "dry-run", command: ["gh", ...args].join(" ") };
  }

  runSync("gh", args);
  const recent = readJsonCommand("gh", [
    "run",
    "list",
    "--repo",
    githubRepo,
    "--workflow",
    workflow,
    "--event",
    "workflow_dispatch",
    "--limit",
    "1",
    "--json",
    "databaseId,status,conclusion,createdAt,url,workflowName,displayTitle",
  ]);
  const run = Array.isArray(recent) ? recent[0] : null;
  return {
    type: "github",
    workflow,
    action: "started",
    id: run?.databaseId ?? null,
    url: run?.url ?? null,
    status: run?.status ?? "unknown",
  };
}

function crabboxCommand(lane, candidate, options) {
  const wrapper = resolve(options.openclawRoot, "scripts/crabbox-wrapper.mjs");
  const base = [
    "node",
    wrapper,
    "run",
    "--provider",
    "blacksmith-testbox",
    "--blacksmith-org",
    "openclaw",
    "--blacksmith-workflow",
    ".github/workflows/ci-check-testbox.yml",
    "--blacksmith-job",
    "check",
    "--blacksmith-ref",
    "main",
    "--idle-timeout",
    "90m",
    "--ttl",
    "240m",
    "--timing-json",
    "--",
  ];

  const candidateExport = candidate.kind === "package"
    ? `export OPENCLAW_CANDIDATE_PACKAGE=${quote(candidate.label)}`
    : "";
  const packageDoctor = [
    candidateExport,
    "tmp=$(mktemp -d)",
    "export HOME=\"$tmp/home\"",
    "export OPENCLAW_HOME=\"$tmp/openclaw\"",
    "export OPENCLAW_STATE_DIR=\"$tmp/state\"",
    "npm install -g \"$OPENCLAW_CANDIDATE_PACKAGE\"",
    "openclaw --version",
    "openclaw doctor --non-interactive",
  ].join(" && ");

  const commands = {
    "package-smoke": candidate.kind === "package"
      ? `echo CRABBOX_PHASE:doctor && ${packageDoctor}`
      : "echo CRABBOX_PHASE:doctor && corepack pnpm release:check",
    "cli-smoke": candidate.kind === "package"
      ? [
        "echo CRABBOX_PHASE:cli-smoke",
        candidateExport,
        "tmp=$(mktemp -d)",
        "export HOME=\"$tmp/home\"",
        "export OPENCLAW_HOME=\"$tmp/openclaw\"",
        "export OPENCLAW_STATE_DIR=\"$tmp/state\"",
        "npm install -g \"$OPENCLAW_CANDIDATE_PACKAGE\"",
        "openclaw --help >/tmp/clawlab-openclaw-help.txt",
        "openclaw doctor --help >/tmp/clawlab-doctor-help.txt",
        "openclaw config --help >/tmp/clawlab-config-help.txt",
        "openclaw plugins --help >/tmp/clawlab-plugins-help.txt",
        "test -s /tmp/clawlab-openclaw-help.txt",
        "test -s /tmp/clawlab-doctor-help.txt",
        "test -s /tmp/clawlab-config-help.txt",
        "test -s /tmp/clawlab-plugins-help.txt",
      ].join(" && ")
      : "echo CRABBOX_PHASE:cli-smoke && corepack pnpm openclaw --help >/tmp/clawlab-openclaw-help.txt && test -s /tmp/clawlab-openclaw-help.txt",
    crabpot: [
      "echo CRABBOX_PHASE:crabpot",
      "tmp=$(mktemp -d)",
      "git clone --depth 1 --branch crab-beta https://github.com/openclaw/crabpot.git \"$tmp/crabpot\"",
      "cd \"$tmp/crabpot\"",
      "npm install",
      "npm run check",
      "npm run plugin-inspector:smoke",
    ].join(" && "),
    "prompt-pack": [
      "echo CRABBOX_PHASE:prompt-pack",
      "mkdir -p .artifacts/clawlab-prompts",
      "corepack pnpm openclaw qa manual --provider-mode mock-openai --message 'Run a compact release smoke turn: check model routing, plugin visibility, and gateway readiness. Return PASS/WARN/FAIL with evidence.' --output-dir .artifacts/clawlab-prompts/release-smoke",
    ].join(" && "),
  };

  return [...base, "bash", "-lc", commands[lane]];
}

function runCrabboxLane(lane, candidate, options) {
  const command = crabboxCommand(lane, candidate, options);
  if (options.dryRun) {
    return { type: "crabbox", lane, action: "dry-run", command: command.join(" ") };
  }
  const startedAt = new Date().toISOString();
  const result = spawnSync(command[0], command.slice(1), {
    cwd: options.openclawRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const idMatch = output.match(/\b(?:tbx|cbx)_[A-Za-z0-9_-]+\b/u);
  const urlMatch = output.match(/https:\/\/github\.com\/openclaw\/openclaw\/actions\/runs\/[0-9]+/u);
  return {
    type: "crabbox",
    lane,
    action: "ran",
    exitCode: result.status,
    id: idMatch?.[0] ?? null,
    url: urlMatch?.[0] ?? null,
    startedAt,
    ok: result.status === 0,
    outputTail: output.split("\n").slice(-30).join("\n").trim(),
  };
}

function downloadableCommand(lane, candidate) {
  const candidatePackage = candidate.kind === "package" ? candidate.label : "openclaw@beta";
  const isolatedPackageInstall = [
    "tmp=$(mktemp -d)",
    "export HOME=\"$tmp/home\"",
    "export OPENCLAW_HOME=\"$tmp/openclaw\"",
    "export OPENCLAW_STATE_DIR=\"$tmp/state\"",
    `npm install -g ${quote(candidatePackage)}`,
  ];
  const commands = {
    "package-smoke": [
      ...isolatedPackageInstall,
      "openclaw --version",
      "openclaw doctor --non-interactive",
    ].join(" && "),
    "cli-smoke": [
      ...isolatedPackageInstall,
      "openclaw --help >/tmp/clawlab-openclaw-help.txt",
      "openclaw doctor --help >/tmp/clawlab-doctor-help.txt",
      "openclaw config --help >/tmp/clawlab-config-help.txt",
      "openclaw plugins --help >/tmp/clawlab-plugins-help.txt",
      "test -s /tmp/clawlab-openclaw-help.txt",
      "test -s /tmp/clawlab-doctor-help.txt",
      "test -s /tmp/clawlab-config-help.txt",
      "test -s /tmp/clawlab-plugins-help.txt",
    ].join(" && "),
    crabpot: [
      "tmp=$(mktemp -d)",
      "git clone --depth 1 --branch crab-beta https://github.com/openclaw/crabpot.git \"$tmp/crabpot\"",
      "cd \"$tmp/crabpot\"",
      "npm install",
      "npm run check",
      "npm run plugin-inspector:smoke",
    ].join(" && "),
    "prompt-pack": [
      `npx -y -p ${quote(candidatePackage)} openclaw --version`,
    ].join(" && "),
  };
  if (!commands[lane]) {
    throw new Error(`unknown download lane: ${lane}`);
  }
  return ["bash", "-lc", commands[lane]];
}

function runDownloadLane(lane, candidate, options) {
  const command = downloadableCommand(lane, candidate);
  if (options.dryRun) {
    return { type: "download", lane, action: "dry-run", command: command.join(" ") };
  }
  const startedAt = new Date().toISOString();
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return {
    type: "download",
    lane,
    action: "ran",
    exitCode: result.status,
    startedAt,
    ok: result.status === 0,
    outputTail: output.split("\n").slice(-30).join("\n").trim(),
  };
}

function runLocalCrabpot(candidate, options) {
  if (!options.suites.has("crabpot")) return null;
  const commands = [
    ["npm", ["run", "check"]],
    ["npm", ["run", "plugin-inspector:smoke"]],
  ];
  const results = [];
  for (const [cmd, args] of commands) {
    if (options.dryRun) {
      results.push({ command: [cmd, ...args].join(" "), action: "dry-run" });
      continue;
    }
    const result = spawnSync(cmd, args, {
      cwd: options.crabpotRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    results.push({
      command: [cmd, ...args].join(" "),
      exitCode: result.status,
      ok: result.status === 0,
      outputTail: `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n").slice(-20).join("\n").trim(),
    });
  }
  return {
    type: "crabpot",
    candidate: candidate.label,
    results,
    ok: results.every((result) => result.action === "dry-run" || result.ok),
  };
}

function writePromptManifest(outputDir) {
  const prompts = [
    "release-smoke.md",
    "plugin-canary.md",
    "provider-routing.md",
    "memory-media.md",
    "browser-tooling.md",
    "organic-agent-day.md",
  ].map((name) => ({
    name,
    path: resolve(root, "prompts", name),
  }));
  writeFileSync(resolve(outputDir, "prompt-pack.json"), `${JSON.stringify(prompts, null, 2)}\n`);
  return prompts;
}

function writeSummary(outputDir, summary) {
  writeFileSync(resolve(outputDir, "manifest.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const lines = [
    `# Clawlab ${summary.candidate.label}`,
    "",
    `- profile: ${summary.profile}`,
    `- fingerprint: ${summary.fingerprint}`,
    `- openclaw: ${summary.preflight.openclawHead}`,
    `- status: ${summary.verdict}`,
    "",
    "## GitHub",
    ...summary.github.map((run) => `- ${run.workflow}: ${run.action}${run.id ? ` ${run.id}` : ""}${run.url ? ` ${run.url}` : ""}`),
    "",
    "## Downloadable",
    ...summary.download.map((run) => `- ${run.lane}: ${run.action}${run.exitCode !== undefined ? ` exit=${run.exitCode}` : ""}`),
    "",
    "## Crabbox",
    ...summary.crabbox.map((run) => `- ${run.lane}: ${run.action}${run.id ? ` ${run.id}` : ""}${run.exitCode !== undefined ? ` exit=${run.exitCode}` : ""}${run.url ? ` ${run.url}` : ""}`),
    "",
    "## Crabpot",
    summary.crabpot ? `- local: ${summary.crabpot.ok ? "pass" : "fail"}` : "- skipped",
    "",
    "## Prompts",
    ...summary.prompts.map((prompt) => `- ${prompt.name}`),
    "",
  ];
  writeFileSync(resolve(outputDir, "summary.md"), `${lines.join("\n")}\n`);
}

function verdictFor(summary) {
  const failedDownload = summary.download.some((run) => run.exitCode !== undefined && run.exitCode !== 0);
  const failedCrabbox = summary.crabbox.some((run) => run.exitCode !== undefined && run.exitCode !== 0);
  const failedCrabpot = summary.crabpot && !summary.crabpot.ok;
  if (failedDownload || failedCrabbox || failedCrabpot) return "LOCAL_FAIL";
  const dry = [...summary.github, ...summary.download, ...summary.crabbox].some((run) => run.action === "dry-run");
  if (dry) return "DRY_RUN";
  const reused = summary.github.some((run) => run.action === "reuse-active");
  if (summary.github.length > 0) {
    return reused ? "REMOTE_REUSED_LOCAL_PASS" : "REMOTE_STARTED_LOCAL_PASS";
  }
  return "LOCAL_PASS";
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function watchGithubRuns(runs) {
  const watched = runs.map((run) => ({ ...run }));
  const watchable = watched.filter((run) => run.id && run.type === "github");
  if (watchable.length === 0) return watched;

  process.stdout.write(`watching ${watchable.length} GitHub run(s)\n`);
  for (let attempt = 0; attempt < 240; attempt += 1) {
    let complete = 0;
    for (const run of watchable) {
      const latest = readJsonCommand("gh", [
        "run",
        "view",
        String(run.id),
        "--repo",
        githubRepo,
        "--json",
        "status,conclusion,url,databaseId",
      ]);
      if (!latest) continue;
      run.status = latest.status;
      run.conclusion = latest.conclusion;
      run.url = latest.url ?? run.url;
      if (latest.status === "completed") complete += 1;
    }
    process.stdout.write(
      `github: ${complete}/${watchable.length} completed (${watchable
        .map((run) => `${run.workflow}:${run.status}${run.conclusion ? `/${run.conclusion}` : ""}`)
        .join(", ")})\n`,
    );
    if (complete === watchable.length) break;
    await sleep(30000);
  }
  return watched;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    process.exit(0);
  }
  if (options.command !== "test") {
    process.stdout.write(usage());
    process.exit(1);
  }
  if (!profiles[options.profile]) {
    throw new Error(`unknown profile: ${options.profile}`);
  }
  if (!["umbrella", "separate"].includes(options.githubMode)) {
    throw new Error(`unknown --github-mode: ${options.githubMode}`);
  }

  const candidate = candidateFromOptions(options);
  const profile = profiles[options.profile];
  const fingerprint = hash(JSON.stringify({
    candidate,
    profile: options.profile,
    githubMode: options.githubMode,
    suites: [...options.suites].sort(),
  }));
  const outputDir = resolve(options.outputRoot, `clawlab-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${fingerprint}`);
  mkdirSync(outputDir, { recursive: true });

  const preflightData = preflight(options);
  const github = workflowPlan(options, candidate, profile).map((workflow) =>
    launchWorkflow(workflow, candidate, profile, options)
  );

  const download = [];
  if (options.suites.has("download")) {
    for (const lane of profile.downloadLanes) {
      download.push(runDownloadLane(lane, candidate, options));
    }
  }

  const crabbox = [];
  if (options.suites.has("crabbox")) {
    for (const lane of profile.downloadLanes) {
      crabbox.push(runCrabboxLane(lane, candidate, options));
    }
  }

  const crabpot = runLocalCrabpot(candidate, options);
  const prompts = options.suites.has("prompts") ? writePromptManifest(outputDir) : [];

  const summary = {
    candidate,
    profile: options.profile,
    fingerprint,
    outputDir,
    preflight: preflightData,
    github,
    download,
    crabbox,
    crabpot,
    prompts: prompts.map((prompt) => ({
      name: prompt.name,
      path: relative(root, prompt.path),
    })),
  };
  if (options.watch && !options.dryRun) {
    summary.github = await watchGithubRuns(summary.github);
  }
  summary.verdict = verdictFor(summary);
  writeSummary(outputDir, summary);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`clawlab: ${summary.verdict}\n`);
    process.stdout.write(`candidate: ${candidate.label}\n`);
    process.stdout.write(`summary: ${relative(process.cwd(), resolve(outputDir, "summary.md"))}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`clawlab: ${error.message}\n`);
  process.exit(1);
});

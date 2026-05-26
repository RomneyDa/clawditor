#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const githubRepo = "openclaw/openclaw";
const kovaRepo = "openclaw/Kova";
const kovaRef = "b63b6f9e20efb23641df00487e982230d81a90ac";
const ocmVersion = "v0.2.15";
const profiles = {
    smoke: {
        releaseProfile: "beta",
        runFullRelease: false,
        packageAcceptanceProfile: "smoke",
        kovaProfile: "smoke",
        kovaRepeat: "1",
        kovaFilters: ["scenario:fresh-install"],
        downloadLanes: ["package-smoke"],
    },
    standard: {
        releaseProfile: "beta",
        runFullRelease: true,
        packageAcceptanceProfile: "package",
        kovaProfile: "diagnostic",
        kovaRepeat: "3",
        kovaFilters: [
            "scenario:fresh-install",
            "scenario:gateway-performance",
            "scenario:bundled-plugin-startup",
            "scenario:bundled-runtime-deps",
            "scenario:agent-cold-warm-message",
        ],
        downloadLanes: ["package-smoke", "cli-smoke", "crabpot"],
    },
    full: {
        releaseProfile: "full",
        runFullRelease: true,
        packageAcceptanceProfile: "full",
        kovaProfile: "release",
        kovaRepeat: "3",
        kovaFilters: [
            "scenario:fresh-install",
            "scenario:gateway-performance",
            "scenario:bundled-plugin-startup",
            "scenario:bundled-runtime-deps",
            "scenario:agent-cold-warm-message",
        ],
        downloadLanes: ["package-smoke", "cli-smoke", "crabpot", "prompt-pack"],
    },
};
const defaultSuites = new Set(["download", "kova", "crabbox", "crabpot", "prompts"]);
function usage() {
    return `Usage:
  clawditor test openclaw@beta [options]
  clawditor test --ref release/2026.5.26 [options]

Options:
  --profile smoke|standard|full       Coverage profile (default: standard)
  --repo <path>                       Local OpenClaw checkout (default: cached openclaw/main clone)
  --crabpot <path>                    Local Crabpot checkout (default: cached crabpot/crab-beta clone)
  --output <path>                     Artifact root (default: .artifacts)
  --cache <path>                      Cache root (default: OS cache dir)
  --suite <names>                     Comma list: github,download,kova,crabbox,crabpot,prompts
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
            cacheRoot: defaults.cacheRoot,
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
        cacheRoot: defaults.cacheRoot,
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
        if (arg === "--help" || arg === "-h")
            options.help = true;
        else if (arg === "--ref")
            options.ref = next();
        else if (arg === "--profile")
            options.profile = next();
        else if (arg === "--repo")
            options.openclawRoot = resolve(next());
        else if (arg === "--crabpot")
            options.crabpotRoot = resolve(next());
        else if (arg === "--output")
            options.outputRoot = resolve(next());
        else if (arg === "--cache")
            options.cacheRoot = resolve(next());
        else if (arg === "--suite")
            options.suites = new Set(next().split(",").map((item) => item.trim()).filter(Boolean));
        else if (arg === "--github-mode")
            options.githubMode = next();
        else if (arg === "--remote" || arg === "--github")
            options.suites.add("github");
        else if (arg === "--force-workflows")
            options.forceWorkflows = true;
        else if (arg === "--no-dedupe")
            options.dedupe = false;
        else if (arg === "--watch")
            options.watch = true;
        else if (arg === "--dry-run")
            options.dryRun = true;
        else if (arg === "--json")
            options.json = true;
        else if (arg.startsWith("--"))
            throw new Error(`unknown option: ${arg}`);
        else
            positional.push(arg);
    }
    if (positional.length > 1) {
        throw new Error(`unexpected argument: ${positional[1]}`);
    }
    if (positional.length > 0 && !options.ref) {
        options.packageSpec = positional[0];
    }
    else if (positional.length > 0 && options.ref) {
        throw new Error("choose either a package argument or --ref, not both");
    }
    else if (positional.length > 0) {
        throw new Error(`unexpected argument: ${positional[0]}`);
    }
    return options;
}
function defaultPaths() {
    return {
        outputRoot: resolve(process.cwd(), ".artifacts"),
        cacheRoot: resolveCacheRoot(),
    };
}
function resolveCacheRoot() {
    if (process.env.CLAWDITOR_CACHE_DIR) {
        return resolve(process.env.CLAWDITOR_CACHE_DIR);
    }
    if (platform() === "darwin") {
        return resolve(homedir(), "Library/Caches/clawditor");
    }
    if (platform() === "win32") {
        return resolve(process.env.LOCALAPPDATA ?? resolve(homedir(), "AppData/Local"), "clawditor/cache");
    }
    return resolve(process.env.XDG_CACHE_HOME ?? resolve(homedir(), ".cache"), "clawditor");
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
function syncGitCheckout(path, repoUrl, ref, label, options) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(resolve(path, ".git"))) {
        logStatus(options, `preflight: refreshing cached ${label} (${ref})`);
        runSync("git", ["-C", path, "fetch", "--depth", "1", "origin", ref]);
        runSync("git", ["-C", path, "checkout", "-q", "FETCH_HEAD"]);
        runSync("git", ["-C", path, "reset", "--hard", "-q", "FETCH_HEAD"]);
    }
    else {
        logStatus(options, `preflight: cloning ${label} (${ref}) into cache`);
        runSync("git", ["clone", "--depth", "1", "--branch", ref, repoUrl, path]);
    }
}
function ensureCachedOpenclawCheckout(options) {
    const path = resolve(options.cacheRoot, "repos/openclaw-suite");
    if (options.dryRun)
        return path;
    syncGitCheckout(path, "https://github.com/openclaw/openclaw.git", "main", "OpenClaw", options);
    return path;
}
function ensureCachedCrabpotCheckout(options) {
    const path = resolve(options.cacheRoot, "repos/crabpot-suite");
    if (options.dryRun)
        return path;
    syncGitCheckout(path, "https://github.com/openclaw/crabpot.git", "crab-beta", "Crabpot", options);
    return path;
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
function logStatus(options, message) {
    if (!options.json) {
        process.stdout.write(`${message}\n`);
    }
}
function stepCommand(label) {
    return `printf 'CLAWDITOR_STEP:%s\\n' ${quote(label)} >&2`;
}
function elapsedSeconds(startedMs) {
    return Math.max(0, Math.round((Date.now() - startedMs) / 1000));
}
function streamProcessOutput(options, prefix, line) {
    if (!options.json) {
        process.stdout.write(`${prefix}: > ${line}\n`);
    }
}
function isHighlightLine(line) {
    return /^OpenClaw \S+/u.test(line) ||
        /^Kova \S+/u.test(line) ||
        /^Verdict:/u.test(line) ||
        /^Status: /u.test(line) ||
        /^(PASS|FAIL|WARN|PARTIAL)\b/u.test(line) ||
        /^(Breakages|Issues|Artifacts): /u.test(line) ||
        /^(Scenarios|Runs|Passed|Failed|Warnings|Regressions): /u.test(line) ||
        /^crabpot report check:/u.test(line) ||
        /^report targets:/u.test(line) ||
        /^contract capture:/u.test(line) ||
        /^synthetic probes:/u.test(line) ||
        /^cold import readiness:/u.test(line) ||
        /^workspace plan:/u.test(line) ||
        /^platform probes:/u.test(line) ||
        /^runtime profile:/u.test(line) ||
        /^contract coverage /u.test(line) ||
        /^ci policy:/u.test(line) ||
        /^generated surface:/u.test(line) ||
        /^openclaw plugin contract check:/u.test(line) ||
        /^added \d+ packages/u.test(line) ||
        /^up to date, audited /u.test(line) ||
        /^ℹ (tests|pass|fail|duration_ms) /u.test(line) ||
        /Doctor complete/u.test(line);
}
function rememberHighlight(highlights, line) {
    const trimmed = line.trim();
    if (!trimmed || !isHighlightLine(trimmed) || highlights.includes(trimmed)) {
        return;
    }
    highlights.push(trimmed);
    if (highlights.length > 40) {
        highlights.splice(0, highlights.length - 40);
    }
}
function missingCommandError(missing) {
    const lines = [`missing required command(s): ${missing.join(", ")}`];
    if (missing.includes("git-lfs")) {
        lines.push("git-lfs is required by the default Crabpot lane because some plugin fixtures use Git LFS-backed submodules.");
        lines.push("On macOS with Homebrew: brew install git-lfs && git lfs install");
        lines.push("To run the lighter local package smoke without Crabpot: clawditor test openclaw@beta --profile smoke");
    }
    return lines.join("\n");
}
function readJsonCommand(command, args, cwd) {
    const result = runSync(command, args, { cwd, capture: true, allowFailure: true });
    if (result.status !== 0)
        return null;
    try {
        return JSON.parse(result.stdout || "null");
    }
    catch {
        return null;
    }
}
function preflight(options, profile) {
    logStatus(options, "preflight: checking required tools");
    mkdirSync(options.cacheRoot, { recursive: true });
    const missing = [];
    const required = ["node"];
    if (options.suites.has("github"))
        required.push("gh");
    if (options.suites.has("download") || options.suites.has("kova"))
        required.push("npm", "npx");
    if (options.suites.has("download") ||
        options.suites.has("kova") ||
        options.suites.has("crabbox") ||
        options.suites.has("crabpot")) {
        required.push("git");
    }
    if (!options.dryRun && options.suites.has("kova")) {
        required.push("curl");
    }
    if (!options.dryRun && ((options.suites.has("download") && profile.downloadLanes.includes("crabpot")) ||
        options.suites.has("crabpot"))) {
        required.push("git-lfs");
    }
    if (!options.dryRun && options.suites.has("crabbox")) {
        required.push("pnpm");
    }
    for (const command of required) {
        if (!commandExists(command))
            missing.push(command);
    }
    if (missing.length > 0) {
        throw new Error(missingCommandError(missing));
    }
    if (options.suites.has("crabbox")) {
        if (!options.openclawRoot) {
            options.openclawRoot = ensureCachedOpenclawCheckout(options);
        }
        else if (!isOpenclawRepo(options.openclawRoot)) {
            throw new Error(`--repo is not an OpenClaw checkout: ${options.openclawRoot}`);
        }
        if (!options.dryRun && !isOpenclawRepo(options.openclawRoot)) {
            throw new Error(`OpenClaw checkout at ${options.openclawRoot} is missing expected files`);
        }
    }
    if (options.suites.has("crabpot")) {
        if (!options.crabpotRoot) {
            options.crabpotRoot = ensureCachedCrabpotCheckout(options);
        }
        else if (!isCrabpotRepo(options.crabpotRoot)) {
            throw new Error(`--crabpot is not a Crabpot checkout: ${options.crabpotRoot}`);
        }
        if (!options.dryRun && !isCrabpotRepo(options.crabpotRoot)) {
            throw new Error(`Crabpot checkout at ${options.crabpotRoot} is missing expected files`);
        }
    }
    const openclaw = options.openclawRoot && existsSync(resolve(options.openclawRoot, ".git"))
        ? localGitInfo(options.openclawRoot)
        : { status: "not required", head: "local package/cache mode" };
    const result = {
        openclawStatus: openclaw.status,
        openclawHead: openclaw.head,
        openclawRoot: options.openclawRoot,
        crabpotRoot: options.crabpotRoot,
        cacheRoot: options.cacheRoot,
        crabboxWrapper: options.openclawRoot ? resolve(options.openclawRoot, "scripts/crabbox-wrapper.mjs") : null,
    };
    logStatus(options, `preflight: ok (${required.join(", ")})`);
    logStatus(options, `cache: ${options.cacheRoot}`);
    return result;
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
    if (!options.suites.has("github"))
        return [];
    if (options.githubMode === "umbrella" && profile.runFullRelease) {
        return ["full-release-validation.yml"];
    }
    return ["package-acceptance.yml", "plugin-prerelease.yml", "openclaw-performance.yml"];
}
function activeWorkflowRun(workflow, options) {
    if (!options.dedupe || options.forceWorkflows)
        return null;
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
        if (Array.isArray(runs))
            active.push(...runs);
    }
    return active.find((run) => run.event === "workflow_dispatch") ?? null;
}
function launchWorkflow(workflow, candidate, profile, options) {
    logStatus(options, `github: checking ${workflow}`);
    const existing = activeWorkflowRun(workflow, options);
    if (existing) {
        logStatus(options, `github: reusing active ${workflow} run ${existing.databaseId}`);
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
        logStatus(options, `github: dry-run ${workflow}`);
        return { type: "github", workflow, action: "dry-run", command: ["gh", ...args].join(" ") };
    }
    logStatus(options, `github: starting ${workflow}`);
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
    const result = {
        type: "github",
        workflow,
        action: "started",
        id: run?.databaseId ?? null,
        url: run?.url ?? null,
        status: run?.status ?? "unknown",
    };
    logStatus(options, `github: started ${workflow}${result.id ? ` run ${result.id}` : ""}`);
    return result;
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
                "openclaw --help >/tmp/clawditor-openclaw-help.txt",
                "openclaw doctor --help >/tmp/clawditor-doctor-help.txt",
                "openclaw config --help >/tmp/clawditor-config-help.txt",
                "openclaw plugins --help >/tmp/clawditor-plugins-help.txt",
                "test -s /tmp/clawditor-openclaw-help.txt",
                "test -s /tmp/clawditor-doctor-help.txt",
                "test -s /tmp/clawditor-config-help.txt",
                "test -s /tmp/clawditor-plugins-help.txt",
            ].join(" && ")
            : "echo CRABBOX_PHASE:cli-smoke && corepack pnpm openclaw --help >/tmp/clawditor-openclaw-help.txt && test -s /tmp/clawditor-openclaw-help.txt",
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
            "mkdir -p .artifacts/clawditor-prompts",
            "corepack pnpm openclaw qa manual --provider-mode mock-openai --message 'Run a compact release smoke turn: check model routing, plugin visibility, and gateway readiness. Return PASS/WARN/FAIL with evidence.' --output-dir .artifacts/clawditor-prompts/release-smoke",
        ].join(" && "),
    };
    return [...base, "bash", "--noprofile", "--norc", "-c", commands[lane]];
}
async function runCrabboxLane(lane, candidate, options) {
    const command = crabboxCommand(lane, candidate, options);
    if (options.dryRun) {
        logStatus(options, `crabbox: dry-run ${lane}`);
        return { type: "crabbox", lane, action: "dry-run", command: command.join(" ") };
    }
    logStatus(options, `crabbox: running ${lane}`);
    const startedAt = new Date().toISOString();
    const result = await runLiveProcess(command, `crabbox: ${lane}`, options, {
        cwd: options.openclawRoot,
    });
    const output = result.output;
    const idMatch = output.match(/\b(?:tbx|cbx)_[A-Za-z0-9_-]+\b/u);
    const urlMatch = output.match(/https:\/\/github\.com\/openclaw\/openclaw\/actions\/runs\/[0-9]+/u);
    const run = {
        type: "crabbox",
        lane,
        action: "ran",
        exitCode: result.exitCode,
        id: idMatch?.[0] ?? null,
        url: urlMatch?.[0] ?? null,
        startedAt,
        ok: result.exitCode === 0,
        highlights: result.highlights,
        outputTail: result.outputTail,
    };
    logStatus(options, `crabbox: ${lane} ${run.ok ? "passed" : `failed exit=${run.exitCode}`}${run.id ? ` (${run.id})` : ""}`);
    if (!run.ok && run.outputTail) {
        logStatus(options, `crabbox: ${lane}: output tail:\n${run.outputTail}`);
    }
    return run;
}
const downloadLaneDescriptions = {
    "package-smoke": "install candidate package in a temp home, run version and doctor",
    "cli-smoke": "install candidate package in a temp home, check core CLI help surfaces",
    crabpot: "clone Crabpot into temp state and run static/plugin-inspector compatibility checks",
    "prompt-pack": "verify candidate package is runnable through npx and write prompt pack metadata",
};
function sourceCheckoutScript(repoVar, cachePath, repoUrl, ref, label) {
    return `${repoVar}=${quote(cachePath)}
if [ -d "$${repoVar}/.git" ]; then
  ${stepCommand(`fetch cached ${label}`)}
  git -C "$${repoVar}" fetch --depth 1 origin ${quote(ref)}
else
  ${stepCommand(`clone ${label}`)}
  mkdir -p "$(dirname "$${repoVar}")"
  git clone --filter=blob:none ${quote(repoUrl)} "$${repoVar}"
  git -C "$${repoVar}" fetch --depth 1 origin ${quote(ref)}
fi
${stepCommand(`checkout ${label}`)}
git -C "$${repoVar}" checkout -q FETCH_HEAD
git -C "$${repoVar}" reset --hard -q FETCH_HEAD`;
}
function downloadCommand(lane, candidate, options) {
    const candidatePackage = candidate.kind === "package" ? candidate.label : "openclaw@beta";
    const npmCache = resolve(options.cacheRoot, "npm");
    const crabpotCache = resolve(options.cacheRoot, "repos/crabpot");
    const openclawCache = resolve(options.cacheRoot, "repos/openclaw");
    const npmCacheEnv = `export npm_config_cache=${quote(npmCache)}`;
    const sourceRefCommand = candidate.kind === "package"
        ? [
            stepCommand(`resolve source tag for ${candidatePackage}`),
            `openclaw_version=$(npm view ${quote(candidatePackage)} version)`,
            "openclaw_ref=\"v$openclaw_version\"",
        ].join(" && ")
        : `openclaw_ref=${quote(candidate.targetRef)}`;
    const openclawSourceSync = `${sourceRefCommand}
openclaw_repo=${quote(openclawCache)}
if [ -d "$openclaw_repo/.git" ]; then
  ${stepCommand("fetch cached OpenClaw source")}
else
  ${stepCommand("clone OpenClaw source")}
  mkdir -p "$(dirname "$openclaw_repo")"
  git clone --depth 1 https://github.com/openclaw/openclaw.git "$openclaw_repo"
fi
printf 'CLAWDITOR_STEP:using OpenClaw source ref %s\\n' "$openclaw_ref" >&2
if git -C "$openclaw_repo" fetch --depth 1 origin "$openclaw_ref"; then
  ${stepCommand("checkout OpenClaw source")}
  git -C "$openclaw_repo" checkout -q FETCH_HEAD
  git -C "$openclaw_repo" reset --hard -q FETCH_HEAD
else
  printf 'CLAWDITOR_STEP:WARN OpenClaw source ref %s was not found\\n' "$openclaw_ref" >&2
  exit 1
fi`;
    const crabpotSync = `repo=${quote(crabpotCache)}
if [ -d "$repo/.git" ]; then
  ${stepCommand("fetch Crabpot crab-beta")}
  git -C "$repo" fetch --depth 1 origin crab-beta
else
  ${stepCommand("clone Crabpot crab-beta")}
  mkdir -p "$(dirname "$repo")"
  git clone --depth 1 --branch crab-beta https://github.com/openclaw/crabpot.git "$repo"
fi
${stepCommand("reset Crabpot checkout")}
git -C "$repo" checkout -q crab-beta
git -C "$repo" reset --hard -q origin/crab-beta
cd "$repo"`;
    const isolatedPackageInstall = [
        "set -euo pipefail",
        stepCommand("create isolated temp home"),
        "tmp=$(mktemp -d)",
        stepCommand("configure npm cache and temp prefix"),
        npmCacheEnv,
        "export npm_config_prefix=\"$tmp/prefix\"",
        "export PATH=\"$npm_config_prefix/bin:$PATH\"",
        "export HOME=\"$tmp/home\"",
        "export OPENCLAW_HOME=\"$tmp/openclaw\"",
        "export OPENCLAW_STATE_DIR=\"$tmp/state\"",
        stepCommand(`npm install -g ${candidatePackage}`),
        `npm install -g ${quote(candidatePackage)}`,
    ];
    const commands = {
        "package-smoke": [
            ...isolatedPackageInstall,
            stepCommand("openclaw --version"),
            "openclaw --version",
            stepCommand("openclaw doctor --non-interactive"),
            "openclaw doctor --non-interactive",
        ].join(" && "),
        "cli-smoke": [
            ...isolatedPackageInstall,
            stepCommand("openclaw --help"),
            "openclaw --help >/tmp/clawditor-openclaw-help.txt",
            stepCommand("openclaw doctor --help"),
            "openclaw doctor --help >/tmp/clawditor-doctor-help.txt",
            stepCommand("openclaw config --help"),
            "openclaw config --help >/tmp/clawditor-config-help.txt",
            stepCommand("openclaw plugins --help"),
            "openclaw plugins --help >/tmp/clawditor-plugins-help.txt",
            stepCommand("verify CLI help output"),
            "test -s /tmp/clawditor-openclaw-help.txt",
            "test -s /tmp/clawditor-doctor-help.txt",
            "test -s /tmp/clawditor-config-help.txt",
            "test -s /tmp/clawditor-plugins-help.txt",
        ].join(" && "),
        crabpot: [
            "set -euo pipefail",
            stepCommand("configure npm cache"),
            npmCacheEnv,
            openclawSourceSync,
            crabpotSync,
            stepCommand("npm install in Crabpot"),
            "npm install",
            stepCommand("npm run check in Crabpot"),
            "npm run check",
            stepCommand("npm run plugin-inspector:smoke in Crabpot"),
            "npm run plugin-inspector:smoke",
        ].join(" && "),
        "prompt-pack": [
            "set -euo pipefail",
            stepCommand(`npx ${candidatePackage} openclaw --version`),
            `npx -y -p ${quote(candidatePackage)} openclaw --version`,
        ].join(" && "),
    };
    if (!commands[lane]) {
        throw new Error(`unknown download lane: ${lane}`);
    }
    return ["bash", "--noprofile", "--norc", "-c", commands[lane]];
}
function runLiveProcess(command, prefix, options, opts = {}) {
    return new Promise((resolveRun) => {
        const startedMs = Date.now();
        const child = spawn(command[0], command.slice(1), {
            cwd: opts.cwd ?? process.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
        });
        const lines = [];
        const highlights = [];
        let currentStep = "starting";
        let pending = "";
        let spawnError = null;
        const rememberLine = (line) => {
            if (line.startsWith("CLAWDITOR_STEP:")) {
                currentStep = line.slice("CLAWDITOR_STEP:".length).trim();
                if (currentStep.startsWith("WARN ")) {
                    logStatus(options, `${prefix}: ${currentStep}`);
                }
                else {
                    logStatus(options, `${prefix}: running ${currentStep}`);
                }
                return;
            }
            lines.push(line);
            if (lines.length > 200) {
                lines.splice(0, lines.length - 200);
            }
            rememberHighlight(highlights, line);
            streamProcessOutput(options, prefix, line);
        };
        const rememberChunk = (chunk) => {
            pending += chunk.toString("utf8");
            const chunkLines = pending.split(/\r?\n|\r(?!\n)/u);
            pending = chunkLines.pop() ?? "";
            for (const line of chunkLines) {
                rememberLine(line);
            }
        };
        child.stdout.on("data", rememberChunk);
        child.stderr.on("data", rememberChunk);
        child.on("error", (error) => {
            spawnError = error;
            rememberLine(error.message);
        });
        const heartbeat = setInterval(() => {
            logStatus(options, `${prefix}: still running ${currentStep} (${elapsedSeconds(startedMs)}s)`);
        }, opts.heartbeatMs ?? 15000);
        child.on("close", (code) => {
            clearInterval(heartbeat);
            if (pending) {
                rememberLine(pending);
            }
            resolveRun({
                exitCode: code ?? (spawnError ? 1 : 0),
                highlights,
                output: lines.join("\n").trim(),
                outputTail: lines.slice(-30).join("\n").trim(),
            });
        });
    });
}
async function runDownloadLane(lane, candidate, options) {
    const command = downloadCommand(lane, candidate, options);
    if (options.dryRun) {
        logStatus(options, `download: dry-run ${lane} - ${downloadLaneDescriptions[lane] ?? "run package/cache lane"}`);
        return { type: "download", lane, action: "dry-run", command: command.join(" ") };
    }
    logStatus(options, `download: running ${lane} - ${downloadLaneDescriptions[lane] ?? "run package/cache lane"}`);
    if (lane === "crabpot") {
        logStatus(options, `cache: crabpot repo ${resolve(options.cacheRoot, "repos/crabpot")}`);
        logStatus(options, `cache: openclaw source ${resolve(options.cacheRoot, "repos/openclaw")}`);
    }
    else {
        logStatus(options, `cache: npm ${resolve(options.cacheRoot, "npm")}`);
    }
    const startedAt = new Date().toISOString();
    const result = await runLiveProcess(command, `download: ${lane}`, options);
    const run = {
        type: "download",
        lane,
        action: "ran",
        exitCode: result.exitCode,
        startedAt,
        ok: result.exitCode === 0,
        highlights: result.highlights,
        outputTail: result.outputTail,
    };
    logStatus(options, `download: ${lane} ${run.ok ? "passed" : `failed exit=${run.exitCode}`}`);
    if (!run.ok && run.outputTail) {
        logStatus(options, `download: ${lane}: output tail:\n${run.outputTail}`);
    }
    return run;
}
function kovaTargetScript(candidate, profile, options) {
    const openclawCache = resolve(options.cacheRoot, "repos/openclaw-kova-target");
    if (candidate.kind === "package" && profile.kovaProfile === "smoke") {
        return [
            stepCommand(`resolve Kova npm target for ${candidate.label}`),
            `openclaw_version=$(npm view ${quote(candidate.label)} version)`,
            "kova_target=\"npm:$openclaw_version\"",
            "printf 'CLAWDITOR_STEP:using Kova target %s\\n' \"$kova_target\" >&2",
        ].join("\n");
    }
    if (candidate.kind === "package") {
        return [
            stepCommand(`resolve Kova source target for ${candidate.label}`),
            `openclaw_version=$(npm view ${quote(candidate.label)} version)`,
            "openclaw_ref=\"v$openclaw_version\"",
            `openclaw_target_repo=${quote(openclawCache)}`,
            'if [ -d "$openclaw_target_repo/.git" ]; then',
            "  " + stepCommand("fetch cached OpenClaw Kova target source"),
            '  git -C "$openclaw_target_repo" fetch --depth 1 origin "$openclaw_ref"',
            "else",
            "  " + stepCommand("clone OpenClaw Kova target source"),
            '  mkdir -p "$(dirname "$openclaw_target_repo")"',
            '  git clone --filter=blob:none https://github.com/openclaw/openclaw.git "$openclaw_target_repo"',
            '  git -C "$openclaw_target_repo" fetch --depth 1 origin "$openclaw_ref"',
            "fi",
            'printf \'CLAWDITOR_STEP:using Kova source ref %s\\n\' "$openclaw_ref" >&2',
            'git -C "$openclaw_target_repo" checkout -q FETCH_HEAD',
            'git -C "$openclaw_target_repo" reset --hard -q FETCH_HEAD',
            `kova_target="local-build:${openclawCache}"`,
            "printf 'CLAWDITOR_STEP:using Kova target %s\\n' \"$kova_target\" >&2",
        ].join("\n");
    }
    return [
        sourceCheckoutScript("openclaw_target_repo", openclawCache, "https://github.com/openclaw/openclaw.git", candidate.targetRef, "OpenClaw Kova target source"),
        `kova_target="local-build:${openclawCache}"`,
        "printf 'CLAWDITOR_STEP:using Kova target %s\\n' \"$kova_target\" >&2",
    ].join("\n");
}
function kovaCommand(candidate, profile, options, outputDir) {
    const kovaCache = resolve(options.cacheRoot, "repos/kova");
    const toolPrefix = resolve(options.cacheRoot, "tools");
    const reportDir = resolve(outputDir, "kova/reports/mock-provider");
    const homeDir = resolve(outputDir, "kova/home/mock-provider");
    const filters = profile.kovaFilters.flatMap((filter) => ["--include", filter]);
    const command = [
        "set -euo pipefail",
        stepCommand("sync Kova"),
        sourceCheckoutScript("kova_repo", kovaCache, `https://github.com/${kovaRepo}.git`, kovaRef, "Kova"),
        stepCommand(`install OCM ${ocmVersion}`),
        `mkdir -p ${quote(toolPrefix)} ${quote(reportDir)} ${quote(homeDir)}`,
        `if [ ! -x ${quote(resolve(toolPrefix, "bin/ocm"))} ]; then curl -fsSL https://raw.githubusercontent.com/shakkernerd/ocm/main/install.sh | bash -s -- --version ${quote(ocmVersion)} --prefix ${quote(toolPrefix)} --force; fi`,
        `export PATH=${quote(resolve(toolPrefix, "bin"))}:$PATH`,
        `export KOVA_HOME=${quote(homeDir)}`,
        kovaTargetScript(candidate, profile, options),
        stepCommand("kova version"),
        "node \"$kova_repo/bin/kova.mjs\" version --plain --no-color",
        stepCommand(`kova matrix plan ${profile.kovaProfile}`),
        [
            "node \"$kova_repo/bin/kova.mjs\" matrix plan",
            "--profile",
            quote(profile.kovaProfile),
            "--target",
            "\"$kova_target\"",
            ...filters.map(quote),
            "--json >/tmp/clawditor-kova-plan.json",
        ].join(" "),
        stepCommand(`kova matrix run ${profile.kovaProfile}`),
        [
            "node \"$kova_repo/bin/kova.mjs\" matrix run",
            "--profile",
            quote(profile.kovaProfile),
            "--target",
            "\"$kova_target\"",
            "--auth mock",
            "--parallel 1",
            "--repeat",
            quote(profile.kovaRepeat),
            "--report-dir",
            quote(reportDir),
            "--execute",
            "--plain",
            "--no-color",
            ...filters.map(quote),
        ].join(" "),
    ].join("\n");
    return ["bash", "--noprofile", "--norc", "-c", command];
}
function latestJsonFile(dir) {
    try {
        return readdirSync(dir)
            .filter((name) => name.endsWith(".json"))
            .map((name) => resolve(dir, name))
            .sort()
            .at(-1) ?? null;
    }
    catch {
        return null;
    }
}
function readJsonFile(file) {
    if (!file)
        return null;
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    }
    catch {
        return null;
    }
}
function kovaReportHighlights(report) {
    if (!report || typeof report !== "object")
        return [];
    const highlights = [];
    const verdict = report.gate?.verdict ?? report.summary?.verdict ?? report.verdict;
    if (verdict)
        highlights.push(`verdict: ${verdict}`);
    const statuses = report.summary?.statuses;
    if (statuses && typeof statuses === "object") {
        highlights.push(`statuses: ${Object.entries(statuses).map(([status, count]) => `${status}=${count}`).join(", ")}`);
    }
    const failingRecords = Array.isArray(report.records)
        ? report.records.filter((record) => record?.status && !["PASS", "SKIP"].includes(record.status))
        : [];
    for (const record of failingRecords.slice(0, 5)) {
        const bits = [
            record.status,
            record.scenario,
            record.title,
            record.providerEvidence?.error,
            record.measurements?.readinessClassificationReason,
        ].filter(Boolean);
        highlights.push(`record: ${bits.join(" - ")}`);
    }
    const repeat = report.performance?.repeat;
    if (repeat !== undefined)
        highlights.push(`repeat: ${repeat}`);
    const groups = Array.isArray(report.performance?.groups) ? report.performance.groups : [];
    for (const group of groups.slice(0, 5)) {
        const label = group.label ?? group.id ?? group.name;
        const p50 = group.durationMs?.p50 ?? group.p50Ms ?? group.p50;
        const p95 = group.durationMs?.p95 ?? group.p95Ms ?? group.p95;
        if (label && (p50 !== undefined || p95 !== undefined)) {
            highlights.push(`${label}: p50=${p50 ?? "?"}ms p95=${p95 ?? "?"}ms`);
        }
    }
    return highlights;
}
function kovaReportOk(report) {
    if (!report || typeof report !== "object")
        return false;
    const gateVerdict = report.gate?.verdict ?? report.summary?.verdict ?? report.verdict;
    if (["FAIL", "BLOCK", "BLOCKED"].includes(String(gateVerdict ?? "").toUpperCase())) {
        return false;
    }
    const statuses = report.summary?.statuses;
    if (!statuses || typeof statuses !== "object")
        return true;
    return Object.entries(statuses)
        .filter(([status]) => !["PASS", "SKIP"].includes(status))
        .every(([, count]) => Number(count) === 0);
}
async function runKova(candidate, profile, options, outputDir) {
    if (!options.suites.has("kova"))
        return null;
    const command = kovaCommand(candidate, profile, options, outputDir);
    const reportDir = resolve(outputDir, "kova/reports/mock-provider");
    if (options.dryRun) {
        logStatus(options, `kova: dry-run ${profile.kovaProfile}`);
        return {
            type: "kova",
            lane: "mock-provider",
            action: "dry-run",
            profile: profile.kovaProfile,
            repeat: profile.kovaRepeat,
            filters: profile.kovaFilters,
            command: command.join(" "),
        };
    }
    logStatus(options, `kova: running mock-provider profile=${profile.kovaProfile} repeat=${profile.kovaRepeat}`);
    logStatus(options, `cache: kova repo ${resolve(options.cacheRoot, "repos/kova")}`);
    logStatus(options, `cache: ocm tools ${resolve(options.cacheRoot, "tools")}`);
    const startedAt = new Date().toISOString();
    const result = await runLiveProcess(command, "kova: mock-provider", options);
    const reportJson = latestJsonFile(reportDir);
    const report = readJsonFile(reportJson);
    const reportOk = kovaReportOk(report);
    const run = {
        type: "kova",
        lane: "mock-provider",
        action: "ran",
        profile: profile.kovaProfile,
        repeat: profile.kovaRepeat,
        filters: profile.kovaFilters,
        exitCode: result.exitCode,
        startedAt,
        ok: result.exitCode === 0 && reportOk,
        reportOk,
        reportJson: reportJson ? relative(outputDir, reportJson) : null,
        reportHighlights: kovaReportHighlights(report),
        highlights: result.highlights,
        outputTail: result.outputTail,
    };
    logStatus(options, `kova: mock-provider ${run.ok ? "passed" : `failed (process exit=${run.exitCode}, report=${reportOk ? "pass" : "fail"})`}`);
    if (!run.ok && run.outputTail) {
        logStatus(options, `kova: mock-provider: output tail:\n${run.outputTail}`);
    }
    return run;
}
async function runLocalCrabpot(candidate, options) {
    if (!options.suites.has("crabpot"))
        return null;
    const commands = [
        ["npm", ["run", "check"]],
        ["npm", ["run", "plugin-inspector:smoke"]],
    ];
    const results = [];
    for (const [cmd, args] of commands) {
        if (options.dryRun) {
            logStatus(options, `crabpot: dry-run ${cmd} ${args.join(" ")}`);
            results.push({ command: [cmd, ...args].join(" "), action: "dry-run" });
            continue;
        }
        logStatus(options, `crabpot: running ${cmd} ${args.join(" ")}`);
        const result = await runLiveProcess([cmd, ...args], `crabpot: ${cmd} ${args.join(" ")}`, options, {
            cwd: options.crabpotRoot,
        });
        results.push({
            command: [cmd, ...args].join(" "),
            exitCode: result.exitCode,
            ok: result.exitCode === 0,
            highlights: result.highlights,
            outputTail: result.outputTail,
        });
        logStatus(options, `crabpot: ${cmd} ${args.join(" ")} ${result.exitCode === 0 ? "passed" : `failed exit=${result.exitCode}`}`);
        if (result.exitCode !== 0 && result.outputTail) {
            logStatus(options, `crabpot: ${cmd} ${args.join(" ")}: output tail:\n${result.outputTail}`);
        }
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
function statusText(run) {
    if (run.action === "dry-run")
        return "dry-run";
    if (run.ok === true)
        return `pass${run.exitCode !== undefined ? ` (exit ${run.exitCode})` : ""}`;
    if (run.ok === false)
        return `fail${run.exitCode !== undefined ? ` (exit ${run.exitCode})` : ""}`;
    if (run.exitCode !== undefined)
        return `exit ${run.exitCode}`;
    return run.action ?? "unknown";
}
function fencedBlock(value) {
    const text = String(value ?? "")
        .trim()
        .split("\n")
        .map((line) => line.length > 240 ? `${line.slice(0, 237)}...` : line)
        .join("\n");
    if (!text)
        return [];
    return ["", "```text", text, "```"];
}
function downloadSummaryLines(run) {
    const lines = [
        `### ${run.lane}`,
        "",
        `- status: ${statusText(run)}`,
        `- purpose: ${downloadLaneDescriptions[run.lane] ?? "package/cache lane"}`,
        `- started: ${run.startedAt ?? "not started"}`,
    ];
    if (run.command)
        lines.push(`- command: \`${run.command}\``);
    if (run.highlights?.length) {
        lines.push("", "Highlights:", ...run.highlights.map((line) => `- ${line}`));
    }
    if (run.outputTail) {
        lines.push("", "Output tail:", ...fencedBlock(run.outputTail));
    }
    return [...lines, ""];
}
function crabboxSummaryLines(run) {
    const lines = [
        `### ${run.lane}`,
        "",
        `- status: ${statusText(run)}`,
        `- started: ${run.startedAt ?? "not started"}`,
    ];
    if (run.id)
        lines.push(`- provider run id: ${run.id}`);
    if (run.url)
        lines.push(`- url: ${run.url}`);
    if (run.command)
        lines.push(`- command: \`${run.command}\``);
    if (run.highlights?.length) {
        lines.push("", "Highlights:", ...run.highlights.map((line) => `- ${line}`));
    }
    if (run.outputTail) {
        lines.push("", "Output tail:", ...fencedBlock(run.outputTail));
    }
    return [...lines, ""];
}
function kovaSummaryLines(run) {
    if (!run) {
        return ["- skipped: Kova suite was not selected.", ""];
    }
    const lines = [
        `### ${run.lane}`,
        "",
        `- status: ${statusText(run)}`,
        `- profile: ${run.profile}`,
        `- repeat: ${run.repeat}`,
        `- started: ${run.startedAt ?? "not started"}`,
    ];
    if (run.reportOk !== undefined)
        lines.push(`- report verdict: ${run.reportOk ? "pass" : "fail"}`);
    if (run.reportJson)
        lines.push(`- report: ${run.reportJson}`);
    if (run.filters?.length)
        lines.push(`- filters: ${run.filters.join(", ")}`);
    if (run.command)
        lines.push(`- command: \`${run.command}\``);
    const highlights = [...(run.reportHighlights ?? []), ...(run.highlights ?? [])];
    if (highlights.length) {
        lines.push("", "Highlights:", ...highlights.map((line) => `- ${line}`));
    }
    if (run.outputTail) {
        lines.push("", "Output tail:", ...fencedBlock(run.outputTail));
    }
    return [...lines, ""];
}
function localCrabpotSummaryLines(crabpot) {
    const lines = [`- status: ${crabpot.ok ? "pass" : "fail"}`, ""];
    for (const result of crabpot.results) {
        lines.push(`### ${result.command}`, "", `- status: ${statusText(result)}`);
        if (result.highlights?.length) {
            lines.push("", "Highlights:", ...result.highlights.map((line) => `- ${line}`));
        }
        if (result.outputTail) {
            lines.push("", "Output tail:", ...fencedBlock(result.outputTail));
        }
        lines.push("");
    }
    return lines;
}
function notRunLines(summary) {
    const lines = [];
    if (summary.github.length === 0) {
        lines.push("- GitHub: remote workflows were not selected. Use `--remote` or `--suite github` to enable.");
    }
    if (summary.download.length === 0) {
        lines.push("- Package/cache lanes: not selected.");
    }
    if (!summary.kova) {
        lines.push("- Kova: not selected.");
    }
    if (summary.crabbox.length === 0) {
        lines.push("- Crabbox: not selected. Add `crabbox` back to `--suite` (and optionally pass `--repo <local-openclaw-checkout>`) to re-enable.");
    }
    if (!summary.crabpot) {
        lines.push("- Crabpot suite: not selected. Add `crabpot` back to `--suite` (and optionally pass `--crabpot <local-crabpot-checkout>`) to re-enable.");
    }
    if (summary.prompts.length === 0) {
        lines.push("- Prompt pack: not selected.");
    }
    return lines.length > 0 ? ["## Not Run", ...lines, ""] : [];
}
function writeSummary(outputDir, summary) {
    writeFileSync(resolve(outputDir, "manifest.json"), `${JSON.stringify(summary, null, 2)}\n`);
    const lines = [
        `# Clawditor ${summary.candidate.label}`,
        "",
        `- profile: ${summary.profile}`,
        `- fingerprint: ${summary.fingerprint}`,
        `- openclaw: ${summary.preflight.openclawHead}`,
        `- status: ${summary.verdict}`,
        `- artifacts: ${relative(process.cwd(), outputDir)}`,
        `- cache: ${summary.preflight.cacheRoot}`,
        "",
        ...(summary.github.length > 0
            ? ["## GitHub", ...summary.github.map((run) => `- ${run.workflow}: ${run.action}${run.id ? ` ${run.id}` : ""}${run.url ? ` ${run.url}` : ""}`), ""]
            : []),
        ...(summary.download.length > 0
            ? ["## Package/Cache Lanes", ...summary.download.flatMap((run) => downloadSummaryLines(run))]
            : []),
        ...(summary.kova ? ["## Kova", ...kovaSummaryLines(summary.kova)] : []),
        ...(summary.crabbox.length > 0
            ? ["## Crabbox", ...summary.crabbox.flatMap((run) => crabboxSummaryLines(run))]
            : []),
        ...(summary.crabpot ? ["## Crabpot", ...localCrabpotSummaryLines(summary.crabpot)] : []),
        ...(summary.prompts.length > 0
            ? ["## Prompts", ...summary.prompts.map((prompt) => `- ${prompt.name} (${prompt.path})`), ""]
            : []),
        ...notRunLines(summary),
        "## Files",
        "- `manifest.json`: full structured result data",
        "- `summary.md`: this review summary",
        ...(summary.kova?.reportJson ? [`- \`${summary.kova.reportJson}\`: Kova JSON report`] : []),
        ...(summary.prompts.length > 0 ? ["- `prompt-pack.json`: prompt preset manifest"] : []),
        "",
    ];
    writeFileSync(resolve(outputDir, "summary.md"), `${lines.join("\n")}\n`);
}
function verdictFor(summary) {
    const failedDownload = summary.download.some((run) => run.exitCode !== undefined && run.exitCode !== 0);
    const failedKova = summary.kova && summary.kova.ok === false;
    const failedCrabbox = summary.crabbox.some((run) => run.exitCode !== undefined && run.exitCode !== 0);
    const failedCrabpot = summary.crabpot && !summary.crabpot.ok;
    if (failedDownload || failedKova || failedCrabbox || failedCrabpot)
        return "LOCAL_FAIL";
    const dry = [...summary.github, ...summary.download, summary.kova, ...summary.crabbox]
        .filter(Boolean)
        .some((run) => run.action === "dry-run");
    if (dry)
        return "DRY_RUN";
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
    if (watchable.length === 0)
        return watched;
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
            if (!latest)
                continue;
            run.status = latest.status;
            run.conclusion = latest.conclusion;
            run.url = latest.url ?? run.url;
            if (latest.status === "completed")
                complete += 1;
        }
        process.stdout.write(`github: ${complete}/${watchable.length} completed (${watchable
            .map((run) => `${run.workflow}:${run.status}${run.conclusion ? `/${run.conclusion}` : ""}`)
            .join(", ")})\n`);
        if (complete === watchable.length)
            break;
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
    const outputDir = resolve(options.outputRoot, `clawditor-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${fingerprint}`);
    mkdirSync(outputDir, { recursive: true });
    logStatus(options, `clawditor: candidate ${candidate.label}`);
    logStatus(options, `clawditor: profile ${options.profile}`);
    logStatus(options, `clawditor: suites ${[...options.suites].join(", ") || "none"}`);
    logStatus(options, `clawditor: writing artifacts to ${relative(process.cwd(), outputDir)}`);
    const preflightData = preflight(options, profile);
    if (!options.suites.has("github")) {
        logStatus(options, "github: skipped (use --remote or --suite github to enable)");
    }
    const github = workflowPlan(options, candidate, profile).map((workflow) => launchWorkflow(workflow, candidate, profile, options));
    const download = [];
    if (options.suites.has("download")) {
        for (const lane of profile.downloadLanes) {
            download.push(await runDownloadLane(lane, candidate, options));
        }
    }
    const kova = await runKova(candidate, profile, options, outputDir);
    const crabbox = [];
    if (options.suites.has("crabbox")) {
        for (const lane of profile.downloadLanes) {
            crabbox.push(await runCrabboxLane(lane, candidate, options));
        }
    }
    const crabpot = await runLocalCrabpot(candidate, options);
    const prompts = options.suites.has("prompts") ? writePromptManifest(outputDir) : [];
    if (options.suites.has("prompts")) {
        logStatus(options, `prompts: wrote prompt pack (${prompts.length} prompts)`);
    }
    const summary = {
        candidate,
        profile: options.profile,
        fingerprint,
        outputDir,
        preflight: preflightData,
        github,
        download,
        kova,
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
    logStatus(options, `summary: writing ${relative(process.cwd(), resolve(outputDir, "summary.md"))}`);
    writeSummary(outputDir, summary);
    if (options.json) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
    else {
        process.stdout.write(`clawditor: ${summary.verdict}\n`);
        process.stdout.write(`candidate: ${candidate.label}\n`);
        process.stdout.write(`summary: ${relative(process.cwd(), resolve(outputDir, "summary.md"))}\n`);
    }
}
main().catch((error) => {
    process.stderr.write(`clawditor: ${error.message}\n`);
    process.exit(1);
});

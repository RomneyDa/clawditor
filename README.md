# clawditor

One-command OpenClaw beta and release-candidate validation launcher.

## Install

From GitHub:

```sh
npm install -g https://github.com/RomneyDa/clawditor/archive/refs/heads/main.tar.gz
```

From a local checkout:

```sh
npm install -g .
```

For local development:

```sh
npm link
```

Source lives in `src/` as TypeScript. The global CLI runs the compiled
`dist/clawditor.js` build:

```sh
npm run build
npm test
```

Then run it from any directory:

```sh
clawditor test openclaw@beta
clawditor test openclaw@2026.5.26-beta.1 --profile full
clawditor test --ref release/2026.5.26 --profile smoke
```

Requirements:

- Node.js
- npm and npx
- git
- curl for the default Kova lane, which installs cached OCM tooling
- git-lfs for the default `standard` and `full` profiles, because Crabpot syncs
  plugin fixtures that include Git LFS-backed submodules

Normal use is local-first and does not require OpenClaw or Crabpot checkouts.
`clawditor` installs candidate npm packages into temporary homes for smoke checks
and uses reusable cached source checkouts only when the Crabpot lane runs.

The default path also runs Kova locally through the mock-provider performance
lane. For package candidates such as `openclaw@beta`, Clawditor resolves the
published version, checks out the matching OpenClaw source tag, and asks Kova's
diagnostic profile to test that checkout as `local-build:<path>`. The lighter
smoke profile can use Kova's `npm:<version>` target directly. Kova and OCM are
cached under the Clawditor cache root.

For package candidates such as `openclaw@beta`, the Crabpot lane resolves the
published package version and checks out the matching OpenClaw source tag
(`v<version>`). If that source ref is missing, the lane fails instead of testing
against an unrelated checkout.

During normal terminal runs, Clawditor streams subprocess output with a lane prefix
while also saving the tail in `manifest.json`. This is the default for download,
Crabbox, and local Crabpot lanes. `--json` keeps the terminal output
machine-parseable and only prints the final summary JSON.

Downloads are cached in the OS cache directory by default:

```text
macOS: ~/Library/Caches/clawditor
Linux: ~/.cache/clawditor, or $XDG_CACHE_HOME/clawditor
Windows: %LOCALAPPDATA%\\clawditor\\cache
```

The cache contains a shared npm cache plus reusable Crabpot and OpenClaw source
checkouts, Kova, and OCM tooling:

```text
clawditor/
  npm/
  repos/
    crabpot/
    kova/
    openclaw/
  tools/
```

Override it with:

```sh
clawditor test openclaw@beta --cache /path/to/cache
```

GitHub Actions are opt-in:

```sh
clawditor test openclaw@beta --remote
```

Local checkouts are optional dev overrides for advanced local Crabbox/Crabpot
lanes:

```sh
clawditor test openclaw@beta --suite crabbox --repo /path/to/openclaw
clawditor test openclaw@beta --suite crabpot --crabpot /path/to/crabpot
```

## Duplicate workflow control

When `--remote` is passed, `clawditor` uses the umbrella `Full Release Validation`
workflow for standard and full profiles. That keeps GitHub-side release work
behind one workflow and uses that workflow's concurrency groups instead of
dispatching separate package, plugin, release, and performance workflows for
every user.

For separate workflow mode, `clawditor` checks active `workflow_dispatch` runs for
the same workflow and reuses the active run instead of starting another one.
GitHub does not expose workflow-dispatch inputs in `gh run list`, so this check
is intentionally conservative. Pass `--force-workflows` or `--no-dedupe` only
when you explicitly want a fresh run.

## Profiles

- `smoke`: fastest meaningful local package install, version, and doctor check.
- `standard`: default. Runs package install/doctor, CLI bootstrap help checks,
  Kova mock-provider performance, and Crabpot/plugin-inspector compatibility
  from downloads.
- `full`: standard local checks plus prompt-pack smoke. With `--remote`, it
  asks GitHub for the broader full release profile.

## Suites

Use `--suite` to limit work:

```sh
clawditor test openclaw@beta --suite github
clawditor test openclaw@beta --suite download
clawditor test openclaw@beta --suite kova
clawditor test openclaw@beta --dry-run
```

Outputs are written under `.artifacts/clawditor-*` with:

- `manifest.json`
- `summary.md`
- `prompt-pack.json`

Package/cache lanes run from npm/GitHub downloads. Optional Crabbox lanes report
the `tbx_...` or `cbx_...` id when the runner output includes one. GitHub lanes
report the run URL when `gh` returns it.

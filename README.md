# clawditor

One-command OpenClaw beta and release-candidate validation launcher.

## How it works

A `clawditor test <candidate>` run executes these stages in order. Default
stages always run; the rest are opt-in via `--remote` or `--suite`.

1. **Preflight** — verifies required commands (`node`, `npm`, `npx`, `git`,
   plus `curl` for Kova, `git-lfs` for the Crabpot lane, `gh` for `--remote`,
   `pnpm` for Crabbox) and resolves the candidate (`openclaw@beta`,
   `openclaw@<version>`, or `--ref <branch/tag/sha>`).
2. **GitHub Actions** *(opt-in: `--remote` or `--suite github`)* —
   dispatches workflows on `openclaw/openclaw` via `gh`. The umbrella mode
   triggers `full-release-validation.yml`; separate mode triggers
   `package-acceptance.yml`, `plugin-prerelease.yml`, and
   `openclaw-performance.yml`. Active runs are reused unless
   `--force-workflows` / `--no-dedupe` is set.
3. **Package/cache lanes** *(default)* — runs each lane from the active
   profile against npm-published artifacts in temp `HOME` / `OPENCLAW_HOME`
   sandboxes:
   - `package-smoke` *(all profiles)*: `npm install -g` the candidate,
     then `openclaw --version` and `openclaw doctor --non-interactive`.
   - `cli-smoke` *(standard, full)*: install candidate and verify
     `--help` output for `openclaw`, `doctor`, `config`, and `plugins`.
   - `crabpot` *(standard, full)*: resolves the matching OpenClaw source
     tag (`v<version>`), clones `openclaw/crabpot` (`crab-beta`) into the
     cache, and runs `npm run check` and `npm run plugin-inspector:smoke`.
   - `prompt-pack` *(full)*: `npx` the candidate to confirm it is
     runnable from a remote install.
4. **Kova** *(default)* — checks out a pinned revision of `openclaw/Kova`
   into the cache, installs OCM (`shakkernerd/ocm`, pinned version) under
   `<cache>/tools`, picks a target (`npm:<version>` for the smoke profile,
   `local-build:<openclaw-checkout>` otherwise), then runs `kova matrix
   plan` and `kova matrix run` against the `mock-provider` lane with the
   profile's repeat count and scenario filters.
5. **Crabbox** *(opt-in: `--suite crabbox --repo <openclaw-checkout>`)* —
   re-runs the package/cache lanes inside a remote sandbox via
   `scripts/crabbox-wrapper.mjs` (the `blacksmith-testbox` provider against
   `openclaw/openclaw`'s `ci-check-testbox.yml`), producing a `tbx_…` /
   `cbx_…` run id for off-machine proof.
6. **Local Crabpot** *(opt-in: `--suite crabpot --crabpot <checkout>`)* —
   dev-override that runs `npm run check` and `npm run plugin-inspector:smoke`
   directly inside a local Crabpot working copy, bypassing the cached
   clone.
7. **Prompt pack** *(default)* — writes `prompt-pack.json` referencing the
   bundled prompt presets under `prompts/`.
8. **Summary** — writes `manifest.json` and `summary.md` under
   `.artifacts/clawditor-*`, then prints the final verdict
   (`LOCAL_PASS`, `LOCAL_FAIL`, `REMOTE_STARTED_LOCAL_PASS`,
   `REMOTE_REUSED_LOCAL_PASS`, or `DRY_RUN`). With `--watch`, GitHub runs
   are polled until they complete before the summary is finalized.

## Install

From GitHub (use the tarball URL):

```sh
npm install -g https://github.com/RomneyDa/clawditor/archive/refs/heads/main.tar.gz
```

> ⚠️ **Do not use `npm i -g github:RomneyDa/clawditor` or `git+https://…clawditor.git`.**
> The npm shortform git-install path symlinks its temporary git-clone
> cache directory as the global install, then deletes that temp directory
> when the install finishes, leaving a dangling symlink and a
> `command not found: clawditor`. This is an npm bug we can't fix from
> inside the package. The tarball URL above downloads and unpacks
> normally and is the reliable install method. If a prior `github:` /
> `git+https://` attempt has left a broken symlink, run
> `npm uninstall -g clawditor` (or
> `rm /usr/local/lib/node_modules/clawditor /usr/local/bin/clawditor`
> on the corresponding paths under your Node prefix) before reinstalling.

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

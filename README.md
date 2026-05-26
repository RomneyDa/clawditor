# clawlab

One-command OpenClaw beta and release-candidate validation launcher.

## Install

From GitHub:

```sh
npm install -g github:RomneyDa/clawlab
```

From a local checkout:

```sh
npm install -g .
```

For local development:

```sh
npm link
```

Then run it from any directory:

```sh
clawlab test openclaw@beta
clawlab test openclaw@2026.5.26-beta.1 --profile full
clawlab test --ref release/2026.5.26 --profile smoke
```

Normal use is local-first and does not require OpenClaw or Crabpot checkouts.
`clawlab` installs candidate npm packages into temporary homes for smoke checks
and clones Crabpot into a temporary directory only when the downloadable Crabpot
lane runs.

GitHub Actions are opt-in:

```sh
clawlab test openclaw@beta --remote
```

Local checkouts are optional dev overrides for advanced local Crabbox/Crabpot
lanes:

```sh
clawlab test openclaw@beta --suite crabbox --repo /path/to/openclaw
clawlab test openclaw@beta --suite crabpot --crabpot /path/to/crabpot
```

## Duplicate workflow control

When `--remote` is passed, `clawlab` uses the umbrella `Full Release Validation`
workflow for standard and full profiles. That keeps GitHub-side release work
behind one workflow and uses that workflow's concurrency groups instead of
dispatching separate package, plugin, release, and performance workflows for
every user.

For separate workflow mode, `clawlab` checks active `workflow_dispatch` runs for
the same workflow and reuses the active run instead of starting another one.
GitHub does not expose workflow-dispatch inputs in `gh run list`, so this check
is intentionally conservative. Pass `--force-workflows` or `--no-dedupe` only
when you explicitly want a fresh run.

## Profiles

- `smoke`: fastest meaningful local package install, version, and doctor check.
- `standard`: default. Runs package install/doctor, CLI bootstrap help checks,
  and Crabpot/plugin-inspector compatibility from downloads.
- `full`: standard local checks plus prompt-pack smoke. With `--remote`, it
  asks GitHub for the broader full release profile.

## Suites

Use `--suite` to limit work:

```sh
clawlab test openclaw@beta --suite github
clawlab test openclaw@beta --suite download
clawlab test openclaw@beta --dry-run
```

Outputs are written under `.artifacts/clawlab-*` with:

- `manifest.json`
- `summary.md`
- `prompt-pack.json`

Downloadable lanes run from npm/GitHub downloads. Optional Crabbox lanes report
the `tbx_...` or `cbx_...` id when the runner output includes one. GitHub lanes
report the run URL when `gh` returns it.

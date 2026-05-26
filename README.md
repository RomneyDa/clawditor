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
clawlab beta --package openclaw@beta
clawlab beta --package openclaw@2026.5.26-beta.1 --profile full
clawlab beta --ref release/2026.5.26 --profile smoke
```

Normal use does not require OpenClaw or Crabpot checkouts. `clawlab` dispatches
GitHub workflows through `gh`, installs candidate npm packages into temporary
homes for smoke checks, and clones Crabpot into a temporary directory only when
the downloadable Crabpot lane runs.

Local checkouts are optional dev overrides for advanced local Crabbox/Crabpot
lanes:

```sh
clawlab beta --package openclaw@beta --suite crabbox --repo /path/to/openclaw
clawlab beta --package openclaw@beta --suite crabpot --crabpot /path/to/crabpot
```

## Duplicate workflow control

`clawlab` defaults to the umbrella `Full Release Validation` workflow for
standard and full profiles. That keeps GitHub-side release work behind one
workflow and uses that workflow's concurrency groups instead of dispatching
separate package, plugin, release, and performance workflows for every user.

For separate workflow mode, `clawlab` checks active `workflow_dispatch` runs for
the same workflow and reuses the active run instead of starting another one.
GitHub does not expose workflow-dispatch inputs in `gh run list`, so this check
is intentionally conservative. Pass `--force-workflows` or `--no-dedupe` only
when you explicitly want a fresh run.

## Profiles

- `smoke`: focused package/Kova plus downloadable package smoke and Crabpot.
- `standard`: umbrella release validation plus downloadable package smoke,
  Crabpot, and package acceptance delegation.
- `full`: full release profile plus prompt-pack smoke.

## Suites

Use `--suite` to limit work:

```sh
clawlab beta --package openclaw@beta --suite github
clawlab beta --package openclaw@beta --suite download
clawlab beta --package openclaw@beta --dry-run
```

Outputs are written under `.artifacts/clawlab-*` with:

- `manifest.json`
- `summary.md`
- `prompt-pack.json`

Downloadable lanes run from npm/GitHub downloads. Optional Crabbox lanes report
the `tbx_...` or `cbx_...` id when the runner output includes one. GitHub lanes
report the run URL when `gh` returns it.

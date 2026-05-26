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

`clawlab` discovers the OpenClaw checkout from the current directory, common
sibling checkout layouts, or `OPENCLAW_ROOT`. Crabpot is discovered similarly
or through `CRABPOT_ROOT`.

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

- `smoke`: focused package/Kova plus Crabbox doctor and Crabpot.
- `standard`: umbrella release validation plus Crabbox doctor, Crabpot, and
  upgrade-survivor.
- `full`: full release profile plus prompt-pack smoke.

## Suites

Use `--suite` to limit work:

```sh
clawlab beta --package openclaw@beta --suite github
clawlab beta --package openclaw@beta --suite crabbox,crabpot
clawlab beta --package openclaw@beta --dry-run
```

Outputs are written under `.artifacts/clawlab-*` with:

- `manifest.json`
- `summary.md`
- `prompt-pack.json`

Crabbox lanes report the `tbx_...` or `cbx_...` id when the runner output
includes one. GitHub lanes report the run URL when `gh` returns it.

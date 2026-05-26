# clawlab

One-command OpenClaw beta and release-candidate validation launcher.

```sh
npm run beta -- --package openclaw@beta
npm run beta -- --package openclaw@2026.5.26-beta.1 --profile full
npm run beta -- --ref release/2026.5.26 --profile smoke
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

- `smoke`: focused package/Kova plus Crabbox doctor and Crabpot.
- `standard`: umbrella release validation plus Crabbox doctor, Crabpot, and
  upgrade-survivor.
- `full`: full release profile plus prompt-pack smoke.

## Suites

Use `--suite` to limit work:

```sh
npm run beta -- --package openclaw@beta --suite github
npm run beta -- --package openclaw@beta --suite crabbox,crabpot
npm run beta -- --package openclaw@beta --dry-run
```

Outputs are written under `.artifacts/clawlab-*` with:

- `manifest.json`
- `summary.md`
- `prompt-pack.json`

Crabbox lanes report the `tbx_...` or `cbx_...` id when the runner output
includes one. GitHub lanes report the run URL when `gh` returns it.

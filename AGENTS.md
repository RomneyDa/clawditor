# AGENTS.md

- Clawlab is new tooling. Do not preserve backward compatibility unless the user explicitly asks for it.
- Prefer the current CLI surface: `clawlab test <candidate>`.
- Delete obsolete aliases, shims, transitional names, and fallback branches instead of keeping them just in case.
- Keep default behavior local-first.
- Run `npm test` after CLI behavior changes.

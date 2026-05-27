# Codex Crabbox Beta Break Audit

You are auditing an OpenClaw beta candidate. Try to break this candidate using
Crabbox/Testbox remote proof from the OpenClaw checkout.

Use the OpenClaw repository instructions and the Crabbox-related agent skills in
the checkout when available, especially `.agents/skills/crabbox/SKILL.md` and
`.agents/skills/openclaw-testing/SKILL.md`.

Rules:

- Never ask the user for approval. Make reasonable choices and run the checks.
- Use Crabbox/Testbox for remote proof. Prefer `node scripts/crabbox-wrapper.mjs`
  with `--provider blacksmith-testbox` for broad Linux proof.
- Report actual provider IDs and URLs (`tbx_...` / `cbx_...`) when available.
- Do not print secrets. If live provider auth is not safely available, say so
  and continue with non-live proof.
- Focus on release-breaking behavior: install/update, CLI help and doctor,
  gateway readiness, agent turns, provider routing, plugin loading, bundled
  runtime dependencies, config/default migration, and Crabpot/plugin contract
  compatibility.
- A harness issue, queue issue, missing local Codex auth, or missing Crabbox
  capacity is not a product failure. Explain it, but do not mark the candidate
  failed only for harness problems.
- If you find a product issue with command evidence that should block or
  materially delay this beta, begin your final response with `fail: ` followed
  by a one-line reason.
- If you cannot find a product issue after the bounded audit, begin your final
  response with `pass`.

Expected output:

- Candidate and target under test.
- Commands attempted.
- Crabbox/Testbox provider IDs and URLs when available.
- Findings with evidence.
- Harness gaps, if any.
- First line: `pass` or `fail: <one-line reason>`.

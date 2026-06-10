---
description: "Pre-commit ritual: review the staged/unstaged changeset, clean it up, review the architecture and refactor where it helps, update docs, and run all verification gates before committing"
name: "prepare for commit"
argument-hint: "Optional: scope/focus (e.g. 'only the frontend changes') or a git ref to review (e.g. 'the last commit', HEAD~2..HEAD)"
agent: "agent"
---
Perform the final preparation ritual before committing. Do NOT run `git commit`,
`git push`, or any history-altering command — stop just before committing and
hand control back to me.

Follow the project conventions in [copilot-instructions](../copilot-instructions.md).

## 1. Investigate the changeset
- I'm likely running this within an existing session where we just did the work,
  so use that conversation context actively — you already know what changed and
  why. Lean on it first instead of rediscovering everything from scratch.
- If little/no context is known, or you need more, investigate the diff yourself:
  run `git status` and `git --no-pager diff` (and `git --no-pager diff --staged`)
  to see exactly what changed. Honor any scope I gave in the arguments.
- The changeset may already be committed as a provisional commit rather than
  staged/unstaged. If I point you at a committed range (e.g. "the last commit",
  `HEAD`, `HEAD~2..HEAD`), review that instead via `git --no-pager show <ref>`
  or `git --no-pager diff <range>`. This ritual still applies — just note that
  cleanup/refactor fixes will land as follow-up edits on top, since I'll amend
  or add commits myself afterward.
- Summarize the change as a short list: what changed and why, grouped by area
  (backend `src/sysgraph/`, frontend `src/sysgraph-ui/`, scripts, docs, deps).
- Flag anything that looks unintended: stray debug output (`console.log`,
  `print`, `[debug]`-style logs), commented-out code, leftover TODOs, temp files,
  large unrelated diffs, or secrets/credentials. List these explicitly.

## 2. Clean up
- Remove debug logging and temporary instrumentation that was clearly added for
  this work (do not remove legitimate logging).
- Revert accidental or out-of-scope edits; keep the diff tight and intentional.
- Do NOT discard unfamiliar in-progress work without asking me first.

## 3. Architecture review & refactoring
This is the moment to step back and reflect on the work in this changeset as a
whole, not just line-by-line.
- Review the design and architecture of what changed: does it fit the existing
  module boundaries and conventions, or does it cut across them awkwardly? Call
  out anything that feels misplaced, leaky, or inconsistent with the patterns in
  [copilot-instructions](../copilot-instructions.md).
- Reflect on simplicity: is this the simplest solution that works? Look for
  over-engineering (premature abstractions, needless indirection, speculative
  generality), unnecessary duplication, dead code, or overly complex logic
  (deep nesting, sprawling functions) that could be simplified.
- Propose safe, in-scope refactorings (renames, extracting a shared helper,
  collapsing duplication, tightening types) and apply them directly — keep them
  tied to this changeset, don't go on an unrelated cleanup spree.
- For anything riskier — unsafe or far-reaching refactorings, behavior-affecting
  restructuring, or changes that touch a lot of unrelated code — do NOT just do
  it. List the options with their trade-offs and ask me whether to proceed
  before making the change.

## 4. Update documentation
- If behavior, architecture, modules, commands, dependencies, or the directory
  layout changed, update the relevant docs to match — primarily
  [copilot-instructions](../copilot-instructions.md), plus `README.md` and any
  module-level comments that are now stale.
- Keep docs accurate to the new state; don't document things that didn't change.

## 5. Verification gates
Run the checks relevant to what changed and fix any failures before proceeding.
- Frontend changed (`src/sysgraph-ui/`): `npm run typecheck`, `npm run lint`
  (fix all errors/warnings — the codebase must stay lint-clean), `npm run test`,
  and `./scripts/build-ui.sh` so `src/sysgraph/dist/` reflects the change.
- Backend changed (`src/sysgraph/`): `./scripts/lint.sh` (ruff + isort) and
  `pytest src/sysgraph/tests/`.
- Python deps changed (`pyproject.toml`): `./scripts/compile-requirements.sh`
  to relock `requirements.txt`.
- npm deps changed (`package.json`): rebuild via `./scripts/build-ui.sh`.

## 6. Final summary
When everything is clean and green, report back:
- A concise bullet summary of the final changeset.
- The verification commands you ran and their results.
- A suggested commit message (concise subject line + short body) following the
  style of recent commits (`git --no-pager log --oneline -10`).
- Anything I should double-check manually (e.g. UI/3D behavior that can only be
  verified in the browser).

Then stop and let me commit.

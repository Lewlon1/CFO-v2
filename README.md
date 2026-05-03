# The CFO's Office

A trust-first personal finance advisor that combines chat (Claude via Bedrock) with a structured dashboard to help users understand and optimise their financial lives. Users share data gradually through conversation and CSV uploads, receiving increasingly personalised advice powered by an AI "CFO" that knows their numbers, understands their psychology, and gives honest strategic advice.

## Repo layout

- **`cfos-office/`** — the Next.js app. See [`cfos-office/README.md`](cfos-office/README.md) for local setup.
- **`docs/`**
  - `audits/` — current audit snapshots (V2 branch state, dead code, component consolidation, lessons learned).
  - `decisions/` — open decision records (e.g. wasted data points still pending wire-up).
  - `design/` — design mockups and visual specs.
  - `archive/` — pre-implementation specs, superseded audits, completed cleanup tracks. Historical reference only.

## Working with Claude Code

The canonical product spec for this repo lives in [`CLAUDE.md`](CLAUDE.md) at the root. It covers the architecture, design principles, model routing, prompt caching, persona rules, and known pitfalls. Read it before making changes.

Sub-folder conventions:

- `cfos-office/AGENTS.md` — Next.js-specific agent rules (the version of Next.js used here has breaking changes from training data).
- `cfos-office/UI-DIRECTION.md` — visual language and component conventions.
- `cfos-office/TECH_DEBT.md` / `DEFERRED.md` / `SESSION-LOG.md` — living registries.

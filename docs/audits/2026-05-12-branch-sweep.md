# Branch sweep — 2026-05-12

Pre-merge audit of every local + remote branch to identify what still
needs to ship vs. what is safe to delete. Performed before consolidating
landing-v4 + theme + onboarding-v2 into a single PR from
`claude/nervous-shannon-750502`.

`main` last advanced on 2026-05-06 with `v2.1 — Phase A` (PR #36).

## Classification

### 🟢 Live — has unique unmerged content

| Branch | Ahead | Behind | Subject | Disposition |
|---|---|---|---|---|
| `claude/nervous-shannon-750502` | 6 | 0 | feat(onboarding-v2): struggle entry, Marcus journey, and chat bridge | **Consolidation target.** Superset of `landing-page-v4-refresh-tCNr4`. Will become the PR. |
| `claude/landing-page-v4-refresh-tCNr4` | 6 | 0 | fix(theme): default to dark and stop tracking OS theme mid-session | Subset of nervous-shannon (all 5 unique commits are reachable from nervous-shannon). Delete on merge. |
| `origin/claude/fix-dark-mode-toggle-FFZmw` | 1 | 0 | fix(theme): pin app to dark mode, eliminate OS-driven flicker | 5-line subset. Behavior superseded by `05d8cfa` in nervous-shannon. Delete on merge. |

### 🔴 Abandoned — needs your call

| Branch | Ahead | Behind | Subject | Why flagged |
|---|---|---|---|---|
| `session-w1.5-01/memory-consistency-fix` | 3 | 186 | feat(context): inject current date and dedupe trips before model context | Local-only. Diverged far back. The diff vs main *removes* system-prompt rules that are still present in main (e.g. "Before asking the user ANY question about their finances…"), so the branch represents an older direction that wasn't carried forward. Intent of the work (date injection, trip dedup, anti-assumption rules) is likely already implemented differently. Recommend deletion or re-extract anything still valuable. |

### ⚪ Stale — content already in main (squash-merged or superseded)

Every branch below has **0 commits ahead of main**, meaning `main` already contains everything in the branch (typically via squash-merge). Safe to delete in bulk.

`laughing-ardinghelli-42b13c` is a special case: 6 commits show as "unique" because squash-merging breaks patch-id matching, but `package.json` version (2.1.0) matches main exactly and commit subjects map 1:1 to the v2.1 release.

#### Release branches
- `origin/claude/laughing-ardinghelli-42b13c` — v2.1 release source (squash-merged as PR #36)
- `origin/claude/prepare-beta-v2-O1zeV` + local copy

#### Feature/fix branches superseded by main
- `origin/claude/wow-moment-v2-E4KD6`
- `origin/claude/extract-office-utils-WFpBD`
- `origin/claude/audit-v2-branch-state-UoHld`
- `origin/claude/fix-upload-cashflow-bug-lsMII`
- `origin/claude/fix-onboarding-issues-ifwJV` (`git cherry` confirms commit is on main)
- `origin/claude/universal-statement-parser-oelN9`
- `origin/claude/charming-wing`
- `origin/new-onboarding-flow`
- `origin/vercel/install-vercel-web-analytics-a7hx3u`

#### Session-* branches (all merged via squash)
- `session-25/folder-detail-views-routing-redirects` + origin
- `origin/session-25/folder-details`
- `session-25/language-tone-landing-page` + origin
- `session-24/beta-readiness-gdpr` + origin
- `session-23/tech-debt-launch-blockers` + origin
- `session-22/prompt-buttons-analytics` + origin
- `session-21/card-only-save-confirmation` + origin
- `session-20/mobile-chat-ux` + origin
- `origin/session-19/office-route-group`
- `session-19/balance-sheet` + origin
- `session-18-first-impression-polish` + origin
- `session-16/repo-audit-landing-page` + origin
- `session-16-time-context-and-value-rules` + origin
- `session-15-onboarding-pipeline` + origin
- `session-14-analytics` + origin
- `session-13-polish-deploy` + origin
- `session-12-data-management` + origin
- `session-11-nudge-system` + origin
- `session-10-trip-planning-scenarios` + origin
- `session-8-monthly-review` + origin
- `session-7-function-calling-tools` + origin
- `session-6-progressive-profiling` + origin
- `session-5-dashboard-dual-views` + origin
- `session-4-aha-moment-and-gap` + origin
- `session-3-upload-dual-categorisation` + origin
- `session-2-chat-foundation` + origin
- `session-1-foundation-value-map` + origin
- `feature/pdf-upload-multi-file` + origin

## Recommended actions

1. **Now** — proceed with consolidation via `claude/nervous-shannon-750502` (Step 2 of the plan).
2. **On PR merge** — delete `claude/landing-page-v4-refresh-tCNr4` and `claude/fix-dark-mode-toggle-FFZmw` (subsets).
3. **Decide before PR closes** — the fate of `session-w1.5-01/memory-consistency-fix`. Worth a 10-minute read on whether any of its 3 commits should be re-extracted before deletion.
4. **Mass cleanup** — bulk-delete all 🟪 stale branches in one go. Suggested command set kept out of this doc to avoid accidental execution; surface as a separate step.

## How this was generated

```bash
git for-each-ref --sort=-committerdate refs/heads refs/remotes/origin \
  --format='%(refname)|%(committerdate:short)|%(subject)'
# For each non-main ref:
git rev-list --count main..<ref>         # ahead
git rev-list --count <ref>..main         # behind
git cherry main <ref>                    # detects squash-merged content
```

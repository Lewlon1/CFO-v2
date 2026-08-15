# The Filing Cabinet — per-user memory files: handoff

**Branch:** `claude/wobbly-spindle-impl-5570b3` (git worktree at `.claude/worktrees/wobbly-spindle-impl-5570b3`)
**Base:** `claude/v2.9-synthesis` — **not** `main`. 10 commits ahead, working tree clean, nothing pushed (the base isn't pushed either).
**Plan:** `~/.claude/plans/how-can-i-implement-wobbly-spindle.md`
**Status:** PR 0 and Phases 1–3 complete, committed, and green on every automated check. Phase 4 (cache restructure) not started. Nothing has been seen in a browser or driven through the persona suite.

## What this is

A per-user file system the CFO reads and writes through tools, filed into the four
office folders the user already sees. The prompt carries a static contract plus a
~500-token index; file bodies arrive mid-turn via `read_memory_file`. The user opens
and edits the same rows in the office.

Three goals, all first-class: the CFO stops forgetting, the prompt stops growing
without a ceiling, and nothing the CFO knows about someone lives where they can't see it.

## Commits

| SHA | What |
|---|---|
| `c36359a` | PR 0 — removed the deprecated `propose_experiment` tool (~5k chars of schema per request) |
| `0c8390d` | Phase 1a — migration 082 + `src/lib/memory/{constants,files}.ts` |
| `55513cb` | Phase 1b — `read` / `write` / `archive_memory_file` tools |
| `377e364` | Phase 1c — `buildMemoryFilesContract()` + `buildMemoryIndexContext()` |
| `5aaf25b` | Phase 2a/2b — the office UI |
| `9f6b133` | Phase 2c — composed Reads filed as documents |
| `1746de7` | SESSION-LOG — Phase 2 |
| `97a92f1` | Phase 3a — portrait digests + refresh hooks + backfill script |
| `5d1f0f3` | Phase 3b — the context diet |
| `bbbef27` | SESSION-LOG — Phase 3 |

51 files, +5605 / −1336.

## What shipped

**Schema** — `supabase/migrations/082_memory_files.sql` (+ the hand-applied twin
`prod-backfill-082_memory_files.sql`). `memory_files` (folder/slug unique per user,
8k content cap, 140-char description, source/updated_by actors, `user_edited_at`,
pinned, soft archive) and `memory_file_revisions` (pre-change snapshots, pruned to 10
per file). RLS own-row on both. **Both GDPR RPCs learn the new tables.**

**Data layer** — `src/lib/memory/files.ts`. Dependency-injected client; this module never
creates one, so the tools pass a user-authenticated client and RLS is the real boundary.
Errors are returned, never thrown, and each says what to do instead — an LLM reads them.

**Tools** — `read_memory_file` (folder alone lists; folder + slug reads a body),
`write_memory_file` (create / append / replace), `archive_memory_file` (soft only).

**Prompt** — `buildMemoryFilesContract()` is static and byte-stable (a test pins that,
because Phase 4 depends on it). `buildMemoryIndexContext()` returns `''` for an empty
cabinet, so a new user pays nothing for a feature they haven't started using.

**Office UI** — `src/components/office/files/` (FileRow, FilesSection, MemoryFileDetail,
MemoryFilePage), four `/office/<folder>/files/[slug]` routes,
`/api/memory/files/[id]` (PATCH edit, POST archive/restore/pin), folder-tab counts on
the home page via `FolderSection`'s long-unused `fileCount` prop.

**Filed documents** — `src/lib/memory/documents.ts`. The first Read creates
`values/first-read`; the value-first recompose and the declared→actual upgrade append
dated, headed entries. Three call sites, one function, and it can never throw into a
Read delivery path.

**Portrait digests** — `src/lib/memory/digests.ts`. `financial_portrait` rows (≥0.6
confidence, non-dismissed) render down to one `patterns` file per folder: deterministic,
pinned, order-stable. Hooked into `portrait-extraction.ts`, both gap analysers, the chat
toolbox's value-preference upsert, and the traits/dismiss route.

**The diet** — `context-builder.ts`. Behavioural traits gone entirely (and the unbounded
`financial_portrait` query with them — one fewer round trip per turn); balance sheet
reduced to totals + counts + priority count; recurring capped at the largest 12; action
items at 5. Every cap ranks before it cuts and says out loud that it cut.

## The trust guarantee, in one paragraph

A user edit sets `user_edited_at`, and from that moment the data layer **refuses** any CFO
`replace` on that file — the CFO may only append. This is enforced in `files.ts`, not in the
UI, so it holds for the tools, the digests, and the Read-filing path alike. The digests
inherit it: once frozen, new traits arrive as dated entries below the user's words, and a
dismissal is written as an explicit "Struck out" line, because the re-render can't run.

## Where the plan was wrong — four corrections, all in code

1. **The 10px file-row radius is an ESLint error.** `cfo/visual-token-guards` bans arbitrary
   radii of 4px+; `DrillDownRow` already draws this row at `rounded-control`. Rows use 8px and
   `UI-DIRECTION.md §File Rows` was amended in the same commit.
2. **Both first-Read variants ship from one route.** `/api/insights/post-upload` picks `mode`
   internally. The two that needed their own hooks are the *rewrites*.
3. **There is no monthly-review completion event.** A review is marked completed only when the
   *next* one starts (`api/review/start:59`) or by the generic sweep in `api/chat/route.ts:174`,
   and unlike a Read there is no composed artefact to file. Left out deliberately — filing one
   means composing a summary, which is a feature, not a hook.
4. **`asset_profile` traits are machine flags, not prose.** `computeTraits` writes
   `has_pension: "yes"`, `net_worth_bracket: "under_10k"`. As bullets that reads "- yes / - no".
   **Net Worth has no digest, by design**, and `balance-sheet/portrait.ts` gets no hook.

## One live defect found and fixed in passing

`ADVISORY_BOUNDARIES` lived inside `buildBalanceSheetContext`, which returns early when a
user has no assets **and** no liabilities. The CFO's hardest rule — no products, no
buy/sell, no suitability — was silently absent for exactly the users least likely to have
met it elsewhere. It is now its own always-present section, in the general branch and the
first-Read branch both.

## Verification

Last run against the final code (only SESSION-LOG changed afterwards):

- `npm run typecheck` ✓
- `npm run knip` ✓
- `npm run lint` — unchanged from the branch baseline of 14 pre-existing `no-explicit-any`
  errors, none in files this branch adds
- `npm run test` — **1662 passing, 138 files** ✓ (up from a 1567 baseline; use the full
  `npm run test`, a scoped vitest misses the `tests/` tree)
- `npm run build` ✓ — all five new routes present

Not verified: anything in a browser. `next dev` does not stay up in `.claude` worktrees.
The Playwright persona suite was not run — it auto-starts a dev server, spends Bedrock,
and leaks a staging user per run.

## What to do next, in order

**1. Apply 082 to prod when ready.** `prod-backfill-082_memory_files.sql` is the hand-applied
twin. It `CREATE OR REPLACE`s `export_user_data` and `delete_user_account`, carrying their
guard, `SET search_path` and `REVOKE`/`GRANT` clauses verbatim — that clobber has bitten this
repo before, so diff it against the live definitions before running.

**2. Backfill existing users** so folders aren't empty on launch day. Dry-run first — it
prints what it would file and writes nothing:

```bash
npx tsx scripts/backfill-memory-digests.ts
```

Then, with staging creds in `.env.local`:

```bash
APPLY=1 npx tsx scripts/backfill-memory-digests.ts
```

Safe to re-run: it goes through the same `refreshMemoryDigests` the live hooks use, so it
inherits the freeze rule and skips digests whose render hasn't changed.

**3. Walk the UI at 375px.** Home folder pills → folder → Files → detail → edit → save →
confirm `user_edited_at` lands → then in chat, confirm the CFO appends to that file rather
than rewriting it. Check `/styleguide` §07 for the FileRow in both themes.

**4. Watch the tool-call logs on staging.** `read_memory_file` should fire before the CFO
answers on a topic that matches an index entry; `write_memory_file` should fire when a user
shares something durable; a request to store a balance should be refused and redirected to a
tool. This read-rate is the metric that says the retrieval contract is working.

**5. Measure the diet.** Unmeasured, and it's the whole business case. Run a fixed 3-turn
scripted conversation against a data-rich staging user before and after, read off the
`llm_usage_log` cost columns (the branch persists per-call cost — don't use the
`[bedrock-usage]` console lines).

**6. Phase 4 — the cache restructure**, where the diet converts into money. The prep is done:
`buildMemoryFilesContract()` and `ADVISORY_BOUNDARIES` are both static, and the contract's
byte-stability is pinned by a test. The plan's Phase 4 section is still accurate; re-locate its
line numbers, they've shifted.

**7. Version and tag** the first shipped phase — next MINOR in `package.json`, git tag,
SESSION-LOG entry, per the repo conventions.

## Gotchas for whoever picks this up

- **The UI survives an unapplied migration on purpose.** `listFolder` failing renders nothing
  rather than an error state, and `countFilesByFolder` returns zeros. If files aren't showing
  up, check that 082 is actually applied before hunting for a UI bug.
- **`memory_folder` enum keys are not route segments.** `cashflow` → `/office/cash-flow`,
  `networth` → `/office/net-worth`. `MEMORY_FOLDER_ROUTES` is the only correct mapping; never
  derive one from the other.
- **The file detail routes are four literal segments, not one dynamic `[folder]`.**
  `NavigationBar` reads the folder colour off `segments[1]`; a dynamic segment there breaks the
  chrome for every page underneath it.
- **`files` has no page of its own** — `NavigationBar`'s parent path special-cases it back to
  the folder, or the back arrow 404s.
- **`types.ts` was hand-edited**, not regenerated. A full regen drags in years of unrelated
  drift; it's already missing `chat_signals` and others, with call sites casting through `any`
  to cope. Treat the regen as a separate chore.
- **The digest render must stay order-stable.** A test asserts that reversing the input changes
  not one byte. If you add a trait type, keep the sort deterministic — an unstable render
  rewrites the file on every portrait write, bumping `updated_at` and busting the cache the
  whole feature exists to protect.

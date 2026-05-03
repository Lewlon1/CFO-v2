# Phase 0 — Root `/src/` orphan tree investigation

## Summary

A `/src/` tree existed at the worktree root (outside `cfos-office/`), 65 .ts/.tsx files, 556 KB. Investigated and confirmed orphan with HIGH confidence. Deleted with user approval. Staged in working tree, no commit.

## Verdict: confirmed orphan, safe to delete

### Evidence

- Committed in `77c8a1d` (2026-04-03) labelled "Add original MVP source and category migration" — explicit historical archive of pre-existing untracked code.
- No commits touched `/src/` since 2026-04-03; meanwhile `cfos-office/src/` received 10+ commits through 2026-04-20.
- Zero cross-tree references: full grep of the worktree (excluding node_modules/.git/ and `/src/` itself) found 6 imports under `cfos-office/`, all resolving to `cfos-office/src/`, never to root `/src/`.
- File-by-file divergence: where same-named counterparts existed (e.g. `demo-flow.tsx`), root version was 288 lines vs cfos-office's 340 lines (with newer features). Root `/src/lib/parsers/` contained empty stub files; cfos-office equivalent has 18 implemented parsers.
- No root-level `tsconfig.json`, `next.config.*`, `package.json`, or `vercel.json` — `/src/` is not consumed by any build tooling.

### What was changed

`git rm -r src` from the worktree root. 69 entries staged for deletion (65 source files + 4 `.DS_Store`). `cfos-office/` untouched.

History preserved in commit `77c8a1d` if ever needed.

## Verification

- `git status --short | grep -vc '^D  src/'` → 0 (every staged change is a deletion under root `/src/`; nothing else affected)
- `find cfos-office/src -type f \( -name "*.ts" -o -name "*.tsx" \) | wc -l` → 369 (intact)
- `npm run lint` → 20 errors, 38 warnings (BASELINE — pre-existing, unchanged by Phase 0)
- `npm run build` → succeeds, all routes produced
- `npm test` → 58/58 passing across 5 files

## Incident note

A first attempt at deletion ran `git rm -r src/` from a shell whose cwd had drifted to `cfos-office/`. This staged 375 deletions of files under `cfos-office/src/` (the live app). Caught immediately via `git status --short` and reverted with `git restore --staged --worktree cfos-office/src/`. Re-ran with explicit cwd at the worktree root. Build/tests verified intact afterwards. Lesson: subsequent tracks must use absolute paths or explicit `cd` in every Bash call.

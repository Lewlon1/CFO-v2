// ============================================================
// The Filing Cabinet — folders, labels, routes and caps
// ============================================================
// The CFO's memory is the filing cabinet the user can already see: the four
// office folders. These constants are the single TS-side source of truth for
// the folder keys and the size limits the data layer enforces.
//
// SOURCE OF TRUTH for the keys: the `memory_folder` Postgres enum (migration
// 082) and `folderColors` in src/lib/tokens.ts. All three must agree.

/** Matches the `memory_folder` Postgres enum exactly. */
export type MemoryFolder = 'goals' | 'cashflow' | 'values' | 'networth'

/** Runtime companion to `MemoryFolder`, in the order folders are presented. */
export const MEMORY_FOLDERS: readonly MemoryFolder[] = [
  'goals',
  'cashflow',
  'values',
  'networth',
] as const

/** Human labels — used in the prompt index and (later) the office UI. */
export const MEMORY_FOLDER_LABELS: Record<MemoryFolder, string> = {
  goals: 'Goals',
  cashflow: 'Cash Flow',
  values: 'Values & You',
  networth: 'Net Worth',
}

/**
 * Office route segment per folder. Deliberately NOT the same string as the
 * enum key: the DB/token key is `cashflow` but the route is `/office/cash-flow`
 * (likewise `networth` → `net-worth`). Never derive one from the other.
 */
export const MEMORY_FOLDER_ROUTES: Record<MemoryFolder, string> = {
  goals: 'goals',
  cashflow: 'cash-flow',
  values: 'values',
  networth: 'net-worth',
}

export function isMemoryFolder(value: unknown): value is MemoryFolder {
  return typeof value === 'string' && (MEMORY_FOLDERS as readonly string[]).includes(value)
}

// ── Caps ───────────────────────────────────────────────────────────────────
// Enforced in src/lib/memory/files.ts with readable errors (an LLM reads them),
// and mirrored as CHECK constraints in migration 082 as a backstop.

/** Active (non-archived) files per folder. Forces consolidation over sprawl. */
export const MAX_FILES_PER_FOLDER = 20

/** ~2k tokens. A file bigger than this defeats the point of the index. */
export const MAX_CONTENT_CHARS = 8000

export const MAX_TITLE_CHARS = 80
export const MAX_DESCRIPTION_CHARS = 140
export const MAX_SLUG_CHARS = 64

/** Pre-change snapshots retained per file; older ones are pruned on write. */
export const MAX_REVISIONS_PER_FILE = 10

/** Index lines rendered per folder before the "…and N more" overflow line. */
export const INDEX_MAX_LINES_PER_FOLDER = 6

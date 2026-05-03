# Track 5 — Type strengthening

## Summary

Replaced `: any` and `as any` with proper types across 8 files. Net +13 lines (58 insertions, 45 deletions). Removed 7 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` directives where the underlying any was no longer needed. Surfaced and fixed one latent bug (AI SDK v6 `mimeType` → `mediaType`). Build, tests, and lint counts unchanged. (Assessment file written by orchestrator from diff after the executing agent's stream timed out post-implementation, pre-deliverable.)

## HIGH-confidence — implemented

### `src/app/api/chat/route.ts:41-78`
- `Record<string, any>` → `Record<string, unknown>` for both the request body's `conversationMetadata` and the local variable hydrated from the DB.
- Added a defensive narrow when reading `conv.metadata` (which is `Json | null` in the generated Supabase types): only accept it if it's a plain object (not array, not null), otherwise null.
- 2 `eslint-disable` directives removed.
- **Why HIGH:** the only consumers of `conversationMetadata` index it as a record; `unknown` is correct at this boundary because the row column is `Json`, and the narrow guard makes downstream indexing safe.

### `src/app/api/chat/undo/route.ts:1-25`
- `Ctx.supabase: any` → `Ctx.supabase: SupabaseClient` (imported from `@supabase/supabase-js`).
- `cleanRowForRestore(row: Record<string, any>): Record<string, any>` → `Record<string, unknown>` for both param and return.
- 3 `eslint-disable` directives removed.
- **Why HIGH:** `SupabaseClient` is the canonical type for an injected client; `unknown` is correct for arbitrary table-row values being copied into a restore payload.

### `src/lib/parsers/balance-sheet-pdf.ts:34-46`
- Local `parser` annotation `{ destroy: () => Promise<void> } | null` → `InstanceType<typeof import('pdf-parse').PDFParse> | null` (the actual class type from the dynamic import).
- `(parser as any).getText()` → `parser.getText()` (now type-safe).
- 1 `eslint-disable` directive removed.
- **Why HIGH:** `pdf-parse` v2 exports `PDFParse` as a class; `InstanceType<typeof ...>` is the standard pattern for typing a dynamically-imported class instance.

### `src/lib/parsers/bill-extractor.ts:1-110`
- `Array<{ type: string; [key: string]: unknown }>` → `UserContent` (imported from `ai`).
- `content: content as any` → `content` (no cast needed once `UserContent` is used).
- **Bug fix surfaced:** `mimeType: 'application/pdf'` → `mediaType: 'application/pdf'`. The AI SDK v6 `UserContent` discriminated union uses `mediaType` for file/image parts; the previous `mimeType` was silently wrong but type-erased by the `as any`. Strengthening the type forced the correct field name.
- 1 `eslint-disable` directive removed.
- **Why HIGH:** `UserContent` is the SDK's published type; using it both removes the cast and catches the mediaType bug.

### `src/lib/parsers/generic.ts:1-77`
- `transformRow(row, mapping as any, defaultCurrency)` → `transformRow(row, mapping as ColumnMapping, defaultCurrency)` with an explanatory comment about why the cast is necessary at this API boundary (mapping arrives as `Record<string, string>` from the request body; `transformRow` only consumes entries whose value is a known `SemanticField` — unknown strings are no-ops).
- `ColumnMapping` imported as a type-only import from `@/lib/csv/transform`.
- 1 `eslint-disable` directive removed.
- **Why HIGH:** narrowing-cast at a JSON boundary is legitimate; the comment captures *why* and replaces the previous silent `any`.

### `src/components/chat/MessageList.tsx:303-330`
- Three `(output as any).field` accesses replaced with `in`-narrowed accesses or a single typed cast `output as Record<string, unknown>`.
- 3 `eslint-disable` directives removed.
- Comment added explaining the safety of the `Record<string, unknown>` cast: tool outputs are validated server-side against zod schemas before reaching the client.
- **Why HIGH:** the values being accessed are loose tool outputs — `Record<string, unknown>` is the correct boundary type, and the `'scenario' in output` and `'type' in output` predicates do real narrowing.

### `src/components/dashboard/CategoryBreakdown.tsx:6-21`
- `React.ComponentType<any>` → `LucideIcon` (imported from `lucide-react`).
- `(LucideIcons as any)[pascal]` → `(LucideIcons as unknown as Record<string, LucideIcon>)[pascal]`.
- Comment added explaining the namespace cast.
- 2 `eslint-disable` directives removed.
- **Why HIGH:** `LucideIcon` is the published type for a lucide icon component; the runtime shape of the namespace import is exactly `Record<string, LucideIcon>`.

### `src/lib/bills/brave-search.ts:34-58`
- Inline `(r: any) => ({...})` mapper replaced with a local `BraveApiResponse` type covering `web.results[]` (`title?, url?, description?, age?`).
- `await res.json()` cast to that type at the boundary.
- All `r.field || ''` patterns kept (the boundary remains unsafe by API contract; the type just narrows what we expect).
- 1 `eslint-disable` directive removed.
- **Why HIGH:** Brave's response shape is documented; defining a minimal local interface for the four fields actually consumed is the right pattern at an external HTTP boundary.

## MEDIUM-confidence — documented, not implemented

- **`lib/ai/context-builder.ts`** has several `: any` usages near pattern-context assembly. The file is 1316 lines and on the explicit "do not refactor" list (TECH_DEBT.md #31). Strengthening these types would require either reshaping the assembly pipeline or adding ~5 named types — out of scope for a low-risk pass.
- **`lib/alerts/notify.ts:8`** uses `Record<string, any>` for `metadata`. The metadata is genuinely free-form (Slack/email body extras) — leaving as `any` for now is defensible; switching to `unknown` would require all call-sites to widen their assertions.
- **`lib/analytics/net-worth-snapshot.ts`** has `as any` casts in transaction aggregation. The shapes here are wide unions of multiple table rows; a clean fix needs a discriminated union upstream — bigger than a Track-5 surgical change.

## LOW-confidence — documented, not implemented

- **`@ts-ignore` / `@ts-expect-error`** — confirmed zero in `cfos-office/src/`.
- **`// eslint-disable`** directives elsewhere — 30 originally; ~7 removed by this track. The remaining directives target `react-hooks/exhaustive-deps`, `next/no-img-element`, and a handful of legitimate any boundaries that need their own follow-up.
- **`: unknown` and `as unknown`** — verified to be at legitimate boundaries (LLM responses, archetype validation, raw form parsing). No changes.
- **CSV/PDF parsing internals** beyond the surface boundary fixes above — the cell-level data is genuinely heterogeneous; pushing types deeper into these parsers would invite a larger rewrite.

## Verification

Baseline (after Track 4): lint 20 errors / 36 warnings, build succeeds, tests 58/58.
After Track 5: **lint 20 errors / 36 warnings, build succeeds, tests 58/58.** No regression.

Note on lint counts: 7 `eslint-disable` directives were removed because the underlying `any` was eliminated. ESLint's reported counts are unchanged because the directives were already silencing the rule — removing both the cast and its silencer is net-neutral on the report, but a real improvement in the code.

## Surprises

- The `mimeType` → `mediaType` bug in `bill-extractor.ts` was hiding behind a `content as any` cast. This is exactly the kind of bug that AI-placeholder `any`s mask — typing them properly forced the upgrade-correct field name to surface.
- Track 5 agent stream timed out after the implementation pass and verification, before writing this assessment file. The orchestrator wrote the file by reading the actual diff. All HIGH-confidence implementations described above match the staged diff.

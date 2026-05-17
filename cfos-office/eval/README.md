# Judge calibration — golden set + self-improvement loop

A semi-automated system for keeping the first-insight LLM-as-judge calibrated against Lewis's pairwise taste.

See [the design doc](../../../.claude/plans/compare-the-outputs-from-precious-shore.md) for full architecture. This README is the operational reference.

## Directory layout

```
eval/
├── golden-set/
│   └── pairs/<pair-id>.json          One file per (response_a, response_b) pair.
│                                     `rating: null` until Lewis rates it.
├── judges/
│   ├── CHAMPION                      One-line pointer to the active judge file.
│   ├── <ts>-baseline.ts              Active champion + historical champions sit here.
│   ├── archive/                      Retired champions (never deleted).
│   └── candidates/                   Untested mutations from `diagnose.ts`.
└── reports/
    ├── <ts>-calibrate.md             Agreement %, confusion table.
    ├── <ts>-diagnose.md              Meta-judge cluster summary + proposed mutations.
    ├── <ts>-tournament.md            Candidates vs champion on full set.
    └── <ts>-promote.md               Promotion log + diff.
```

## Lewis's weekly flow

```bash
# Seed pairs (run a few times — once per persona / prompt variant you're curious about)
npx tsx scripts/compare-first-insight.ts <userId> --capture

# Once a week (~15 min total):
npx tsx scripts/eval/rate.ts            # ~10 min: walk through unrated pairs
npx tsx scripts/eval/calibrate.ts       # ~1 min: see champion's agreement %
npx tsx scripts/eval/diagnose.ts        # ~2 min: meta-judge proposes mutations
npx tsx scripts/eval/tournament.ts      # ~5 min: score candidates against champion
npx tsx scripts/eval/promote.ts <id>    # ~30s: replace champion (with confirmation)
```

## Key invariants

1. **Lewis is the source of truth** — pairwise preferences only. No automated relabelling.
2. **Judge produces a scalar `wow_score ∈ [0,1]` per response.** Pair winner derived from two scalars.
3. **Holdout fold (~20%) is deterministic** by `hash(pair_id)`. Never reassigned.
4. **Promotion requires beating champion on BOTH train AND holdout** (≥+2pp each, holdout CI lower bound > champion point estimate). Marginal or tied → champion stays.
5. **Diagnose is non-destructive.** Mutations are markdown diffs until Lewis runs `promote`.

## Adding pairs manually

If you want to add a pair from outside the harness (e.g. hand-crafted ideal responses), create a JSON file matching the `GoldenPair` shape in `_lib/pair-storage.ts` and drop it in `pairs/`. The fold field is computed deterministically — `assignFold(pair_id)` in `_lib/pair-storage.ts`.

## Cost

Per full cycle (calibrate → diagnose → tournament → promote) on ~20 rated pairs:
- Calibrate: 1 Haiku call per response per pair → ~$0.20
- Diagnose: 1 Sonnet call → ~$0.10
- Tournament: 1 Haiku call per response per candidate per pair → ~$0.60 for 3 candidates
- Promote: free
- **Total per cycle: ~$1-2**

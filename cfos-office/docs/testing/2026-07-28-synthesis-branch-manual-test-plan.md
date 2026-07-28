# Manual test plan — `claude/v2.9-synthesis`

Written 2026-07-28. Companion to the SESSION-LOG entry of the same date.

This branch is a synthesis of four previously-separate lines. The point of this
document is that you can hold "what should be different here" in your head while
clicking, instead of rediscovering it.

---

## 0. Running it

**Use the production build, not `next dev`.** The onboarding persona harness cannot
run against `next dev` on this codebase — Turbopack compiles routes on first hit and
the sign-in redirect blows its 30s budget while `/office` compiles. Every persona
dies at sign-in. Manual clicking has the same problem, just less fatally: the first
hit on each route stalls for 20s+.

```bash
cd cfos-office && npm run build
```

Then start the `cfos-office (prod server, for the onboarding harness)` launch config.

**Two traps that each cost a cycle:**
- `next start` serves the **built** bundle. A prompt or copy change is invisible until
  you rebuild. If a change "didn't take", rebuild before debugging it.
- Do not leave the server running during `npm run build` — it holds `.next` while the
  build overwrites it, and Turbopack dies with an unrelated-looking panic about
  `globals.css`.

Automated suite, for reference:

```bash
npm run test:onboarding -- --run-id my-run --no-unit
```

**Environment:** staging only (`qlbhvlssksnrhsleadzn`) — the harness refuses to run
against anything else. `VALUE_MAP_V2` is **ON by default** on this branch; set
`VALUE_MAP_V2=0` to fall back to the v1 Value Map.

---

## 1. What differs, branch by branch

`main` = v2.8.0 deployed · `v2.9` = release branch · `Stack A` =
`claude/session-b1-gdpr-cost-floor-9o8fpq` · `PR #70` = `claude/nifty-carson-4jzdl2`

| Capability | main | v2.9 | Stack A | PR #70 | **this branch** |
|---|---|---|---|---|---|
| Steps to first Read | 6 | 6 | 6 | **8** | 6 |
| Upload required to get a Read | **yes** | no | no | no | no |
| Declared (no-upload) Read | — | yes | yes | yes* | yes |
| `≈` on self-reported figures | — | — | — | yes | **yes** |
| Named per-band miss reconciliation | — | — | — | —† | **yes** |
| In-chat declared→actual upgrade | — | yes | yes | — | yes |
| Knows-you meter | — | yes | yes | yes | yes **+ confirm-beat fix** |
| LLM kill switch / per-user caps | — | — | yes | — | yes |
| Cost meter (`rates.ts`) | — | — | yes | — | yes |
| Value Map | v1 | v1 | v1 | v2 | **v2, default ON** |
| Alignment Score tile | — | — | — | yes | yes |
| Archetype | free-form LLM | free-form | free-form | deterministic taxonomy | deterministic taxonomy |
| Payback screen | — | — | — | yes | yes |
| `PlanProvenance` on /office/goals | — | — | — | yes | yes |
| `/office/models` (property decision) | — | — | — | — | **yes, only here** |
| `/admin/beta` funnel dashboard | — | yes | **no**‡ | — | yes |
| `import_attempts` logging | — | — | yes | — | yes |

\* PR #70's is an *estimate Read* off a different 8-step flow, not the same artefact.
† PR #70 had a reality-check Read that reconciled estimate vs actual, but as prose,
not a server-computed per-band list.
‡ Stack A is 14 commits behind v2.9 and never picked up the funnel work.

**The one-line version:** this branch is `v2.9` + Stack A's guards and friction fixes
+ Models M1 + PR #70's Value Map half + the two Read devices that made PR #70's
onboarding score well — but *not* PR #70's 8-step flow.

---

## 2. Test paths

### Path A — declared Read (skip upload) · **highest value, most changed**

1. Sign up fresh → answer the entry question → set a goal with a target and a date.
2. At the upload beat, take **"I don't have a statement handy"**.
3. Fill income and fixed costs.
4. **At the confirm beat, before clicking "Looks right": read the meter.**
5. Accept the reconciliation, read the Read.

**What to check:**

- **Meter says 60%**, not 40%. Chips: Goal, Income, Fixed costs lit; "A real month"
  unlit. *This was 40% on every prior branch — the fix is new here.*
- **Every self-reported figure carries `≈`**: take-home, fixed costs, free cash, the
  leftover cushion, the %-of-take-home.
- **These do NOT carry `≈`**: the goal target, the amount already saved, the monthly
  pace. Statements don't correct a target you chose. If you see `≈£40,000` on the
  goal target, that's a bug.
- **No doubled hedge** — "about ≈£1,900" is wrong, "≈£1,900" is right.
- **The goal is named** as you named it ("House deposit", not "your deposit").
- The close should turn on the marker — something like *"statements replace every ≈
  with a real figure"*.

**vs other branches:** on `main` this path doesn't exist (upload is mandatory). On
`v2.9`/Stack A you get the same Read *without* any `≈` and with the honesty carried
only by a caveat paragraph. Compare which one you actually believe.

### Path B — declared → actual upgrade · **second-most changed**

1. Complete Path A.
2. Tap the Read's CTA ("Show me my last 3 months") and upload real statements in-chat.
3. Read the appended upgrade Read.

**What to check:**

- It should **name specific bills** with both sides: *"you put the gym at ≈£90, it's
  £48"*. Direction stated. At most two of these.
- If there are misses in both directions it should prefer one of each — a
  reconciliation that only ever finds bad news reads as a scolding.
- It should say **which bands are still estimates** (couldn't be isolated) and those
  keep their `≈`.
- It may list **committed costs found that you never declared**.
- It should NOT call an unverified band "confirmed", and should NOT moralise about a
  wrong estimate.

**Not yet exercised live** — this is the one part of the Read work verified only by
unit tests. If it misbehaves, that's the least-surprising place.

**vs other branches:** `v2.9`/Stack A give you an upgrade Read with two aggregate
numbers (fixed costs before/after, free cash before/after) and no per-bill detail.

### Path C — Value Map v2

Reach the Value Map after a Read with real transactions.

**What to check:**

- Cards are your **real merchants**, not samples.
- Leak/burden cards ask a **cut-intent** question.
- After sorting: an **archetype reveal** screen, then a **payback screen**
  ("X answers → Y mapped → £Z/month carries your values").
- `/office/values` shows an **Alignment Score** tile with a 6-month sparkline. Below
  0.4 coverage it should show a *calibrating* state naming the exact unmapped £/month
  — not a score.
- `/office/goals` shows **PlanProvenance** (frame line, protected list, funded-by,
  burden queue).

**vs other branches:** everything in this section is absent on `main`, `v2.9` and
Stack A — they have Value Map v1: card sort, free-form LLM archetype naming, no
reveal, no payback, no score. Set `VALUE_MAP_V2=0` to see v1 for comparison; that
path is unchanged and fully wired.

### Path D — Models (only exists here)

`/office/models` → start a property decision → answer the interview → verdict.

**What to check:** assumptions ledger is editable; each verdict number has an
explanation; flip points and multi-horizon timelines render. Engine numbers are
server-computed against golden fixtures — if a figure looks wrong, that's a real bug,
not model drift.

### Path E — guards (deliberately hard to see)

Healthy behaviour is invisible. Worth one check: set `LLM_DISABLED=1` and confirm the
app degrades with a clear message rather than erroring or silently burning budget.
Per-user burst and daily caps and the block flag (`user_profiles.llm_blocked_at`) are
Stack A work — absent on `main` and `v2.9`.

---

## 3. Known issues — don't re-report these

| Issue | Status |
|---|---|
| 9 of 11 personas fail the automated suite at `upload_done` (Continue button) | **Untriaged.** May be harness-side. Manual upload path needs a human eye. |
| `tests/onboarding/fixtures/reads/skip-upload-declared.captured.txt` has no `≈` | Stale — predates the device. It's a judge *input*, not an expected output, so tests stay green. Wants a live re-capture. |
| Migrations `072` and `073` each appear twice | Deliberate, untouched pending your sign-off. Distinct filenames, staging has all four applied, nothing conflicts. **Reconcile before adding any new migration.** |
| 3 probe users on staging (`...declared-probe{,2,3}@cfo-test.local`) | Left deliberately so their Reads could be inspected. Safe to delete. |

---

## 4. Fastest path to a verdict

If you only have twenty minutes: **Path A, then Path B.** That is where nearly all the
new product surface lives, it's the flow every user hits, and it's the only place the
`≈` work and the reconciliation can be judged. Path C is a large but flag-gated
addition you can defer; Path D is self-contained and new, so nothing regresses if it's
wrong.

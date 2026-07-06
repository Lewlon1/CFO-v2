# CLAUDE.md — The CFO's Office

## What this is

A **financial education product**. C., the user's personal CFO, reads their real
money, computes what's true, and teaches them what it means — the gap between
where their money goes and where they said they want it to go.

**Observe, calculate, educate.** C. is not an advisor. It never sells,
recommends, or assesses financial products. That boundary is the trust
positioning, not just compliance.

Markets: UK + Spain. Mobile-first.
Stack: Next.js App Router · TypeScript · Tailwind v4 · Supabase (Auth + Postgres + RLS) · AWS Bedrock (Claude, EU profiles) · Vercel.

## The rules

**1. Education, not advice — the perimeter, in both directions.**
Allowed: explaining financial concepts; naming patterns in the user's own money
with their own numbers; observational comparison against published benchmarks
(Ofcom, ONS, ABI / CNMC, INE); proposing next steps on the user's own money
("cancel the dormant three", "move the transfer to payday", "set a date").
Banned: naming products or providers as recommendations; buy/sell/switch calls
on instruments; suitability framing (FCA, MiFID II, MCOB, CNMV).
The boundary forbids selling, not helping. A Read that observes without an
actionable next step **violates** this rule — it doesn't honour it.

**2. The system computes. The LLM interprets.**
Every number is computed server-side and handed to the model verbatim. The
model never does arithmetic, dates, or projections — if it needs a number, it
calls a tool. Validators enforce this; treat a hallucinated figure as a bug.

**3. Production is untouchable.**
Automation never writes to prod Supabase (`iccelmjenljanqrhhzdv`). All writes
and migrations go to staging (`qlbhvlssksnrhsleadzn`), additive-only. Prod
changes ship as `prod-backfill-*` companion SQL marked do-not-apply — Lewis
runs them manually.

**4. Phase 0 before any writes.**
Every session starts with a read-only audit of actual state. Never assume a
column name — discover via `information_schema` first (live schema diverges
from docs; e.g. `value_map_results` keys on `profile_id`, not `user_id`).

**5. EU or nothing.**
Bedrock model IDs always use the `eu.` cross-region inference profile. Data
stays in EU regions. GDPR-by-architecture is a moat; one non-EU call breaks it.

**6. Pay back every input.**
Never gate value behind data collection — show what you can with what you
have. Ask late, ask little: 1–2 profile questions per conversation, each with
a stated rationale and what it unlocks.

**7. Voice lives in CFO-CONSTITUTION.md — nowhere else.**
Don't restate voice rules in code, prompts, or this file. When a prompt's
instructions change, re-derive its few-shot examples in the same edit —
examples teach voice more than rules do.

**8. One source of truth per fact.**
Colour: `globals.css` (`tokens.ts` is the typed accessor). Lessons and
gotchas: `SESSION-LOG.md`, append-only, one file. Tool definitions: the
toolbox in `src/lib/ai/tools/` — never trust a doc's copy. If two sources
disagree, fix the consumer; never create a third. Treat `BUILD-STATUS.md`
as untrusted until verified against the repo.

## Conventions

npm, not pnpm · branches: `claude/[session-name]` · a session isn't done until
`npm run typecheck && npm run build` are green · append lessons learned to
`SESSION-LOG.md` before closing.

## Pointers

- `CFO-CONSTITUTION.md` — C.'s voice, structure rules, banned language
- `cfos-office/SESSION-LOG.md` — history, lessons, schema gotchas (append-only)
- `cfos-office/docs/` specs — feature behaviour; when a spec and the code
  disagree, the code is reality and the spec needs the fix

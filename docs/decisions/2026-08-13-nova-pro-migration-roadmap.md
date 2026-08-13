# Roadmap — Nova Pro migration + caching/routing fixes

**Status:** Proposed
**Date:** 2026-08-13
**Follows:** [`2026-08-12-bedrock-model-cost-comparison.md`](./2026-08-12-bedrock-model-cost-comparison.md)
**Decision:** Adopt `eu.amazon.nova-pro-v1:0`, staged behind evidence gates, and
land the six structural fixes from the comparison doc first.

---

## Why this order

The comparison doc ranked the model swap **last**, behind six fixes that carry no
capability tradeoff. That ordering still holds, for a reason that is now sharper
rather than weaker:

**The caching fixes are prerequisites for measuring the swap honestly.** If we
swap models while the persona block is still cached per-user (§5.1 of the
comparison doc), we will be comparing a well-configured Nova against a
mis-configured Sonnet and drawing the wrong conclusion about both. Fix the
architecture, establish a clean baseline, *then* change the variable.

Everything in Phases 1–3 is also worth doing whether or not Nova ever ships.

### What changed since the comparison doc

Three verifications that materially de-risk Nova specifically:

| Finding | Impact |
|---|---|
| `eu.amazon.nova-pro-v1:0` is published across eu-central-1, eu-west-1, eu-west-3, eu-north-1 | The residency constraint that excludes DeepSeek does **not** apply to Nova |
| Nova Pro supports cache checkpoints on `system`, `messages`, **and `tools`** | Directly addresses the open §5.6 question — with Nova we can cache the 47 tool schemas explicitly rather than hoping they land in the prefix |
| Nova cache limit: **20k tokens**, 4 checkpoints, 1,024-token minimum | New constraint. Our static floor is ~9–10k tokens *before* per-user data — headroom is real but not generous. **Must be measured (Phase 0).** |

Indicative pricing — still unverified, per the comparison doc:

| Model | Input $/M | Output $/M |
|---|---|---|
| Claude Sonnet 4.6 (chat today) | ~3.00 | ~15.00 |
| Claude Haiku 4.5 (utility today) | ~1.00 | ~5.00 |
| **Amazon Nova Pro** | **~0.40** | **~1.60** |
| Amazon Nova Lite | ~0.06 | ~0.24 |

Nova Pro undercuts **Haiku**, not just Sonnet — so it is a candidate for both
tiers. Nova Lite is worth a look for the highest-volume utility work
(categorisation) once Pro is proven.

---

## Phase 0 — Verify and baseline *(blocking gate)*

Nothing downstream is safe to decide without these three numbers. All read-only.

**0.1 Confirm Nova Pro in our account and region.**

```bash
aws bedrock list-inference-profiles --region "$AWS_REGION" \
  --query "inferenceProfileSummaries[?contains(inferenceProfileId,'nova')].inferenceProfileId" \
  --output text
```

Must return `eu.amazon.nova-pro-v1:0`. Also confirm model access is *enabled* for
the account — publication and entitlement are different things.

**0.2 Measure the real system-prompt token count.** Against the 20k Nova cache
cap, for the largest realistic user (full profile, 6 snapshots, portrait, goals,
trips, balance sheet). Use `buildSystemPrompt()` output length, not an estimate.

> **Gate:** if a realistic prompt exceeds ~18k tokens, the Nova chat swap is
> constrained and Phase 4b needs a prompt-trimming workstream ahead of it. The
> utility tier (Phase 4a) is unaffected either way.

**0.3 Establish the current cache-hit baseline.** Pull `[bedrock-usage]` lines
from Vercel logs over a representative window; compute
`cacheReadTokens / (cacheReadTokens + cacheCreationTokens)`. This is the number
Phase 1 has to beat, and without it we cannot claim Phase 1 worked.

**Deliverable:** three numbers appended to the comparison doc. No code.

---

## Phase 1 — Caching architecture *(no model change)*

The highest-value work in this roadmap. Sonnet stays; only prompt structure moves.

**1.1 Second cache point after the persona block.**
`src/lib/ai/context-builder.ts` — the three assembly branches at `:807`, `:917`,
`:984` all share the shape:

```ts
const sections = [
  BASE_PERSONA + styleModifier,   // ~5k tokens, 3 variants total
  buildCurrentDateContext(),
  ...                             // per-user dynamic data
].filter(Boolean);
return sections.join('\n\n---\n\n');
```

`buildSystemPrompt()` currently returns a single `string`, and `chat/route.ts:465`
attaches one cache point to it. To place a breakpoint *between* sections, the
return type has to become segmented — e.g. `{ cachedPrefix: string; tail: string }`
— and the chat route emits two system content blocks, each with its own
`cachePoint`.

Effect: at most **three** globally shared prefix entries (blunt / gentle / direct)
instead of one per user per conversation.

- Touches: `context-builder.ts`, `chat/route.ts`, `scripts/test-prompts.ts:277`
  (mirrors the cache config and must stay in sync).
- Watch: the AI SDK's Bedrock provider must map multiple system blocks with
  cache points onto Converse `system[]` checkpoints. **Verify against
  `@ai-sdk/amazon-bedrock@^4.0.89` before building on it** — if unsupported, this
  phase needs a different mechanism and the estimate changes.

**1.2 Settle tool-schema cache placement (§5.6).** With 1.1 instrumented, compare
`cacheReadTokens` against the known prefix size. If the 47 schemas are outside the
cached prefix on Claude, that is a standing cost Nova can fix (Nova caches `tools`
explicitly) — and becomes an argument *for* the swap rather than a risk of it.

**1.3 Cache the forced-retry path.** `chat/route.ts:889` uses top-level `system:`
with no cache point and passes the full 47-tool `toolbox` to force one
`record_value_classifications` call. Move it onto the same segmented system
message and pass only the tool it forces.

**1.4 Cache `compose-first-read`.** `src/lib/ai/compose-first-read.ts:198` sends
6–9 KB of static prompt uncached per call.

**Verify:** `npm run test:prompts` (9 deterministic cases, reports cache
read/write per case) — cache reads should rise sharply against the 0.3 baseline
with no case regressions.

---

## Phase 2 — Routing corrections *(no model change)*

**2.1 Stop paying Sonnet for extraction.** `analysisModel = bedrock(chatModelId)`
(`provider.ts:29`) is Sonnet. Move consumers to `utilityModel`:

| File | Line | Input | Move now? |
|---|---|---|---|
| `lib/ai/tools/search-bill-alternatives.ts` | 146 | text | **Yes** — no vision risk |
| `lib/parsers/screenshot.ts` | 32 | image | Behind `parse:diagnose` evidence |
| `lib/parsers/balance-sheet-screenshot.ts` | 30 | image | Behind evidence |
| `lib/parsers/balance-sheet-pdf.ts` | 74 | PDF | Behind evidence |
| `lib/parsers/bill-extractor.ts` | 103 | image | Behind evidence |

The four vision sites need a quality check first — `SESSION-LOG.md:2287` already
records Haiku currency detection as inconsistent, so do **not** assume these move
cleanly. `npm run parse:diagnose` runs real files and is the right instrument.
Once `analysisModel` has no consumers, delete the export.

**2.2 Gate the public Opus endpoint.** `src/app/api/demo/reading/route.ts:251`
hardcodes `bedrock('eu.anthropic.claude-opus-4-6')` with no env override, on an
unauthenticated pre-signup route. Route it through an env var; separately decide
whether an unauthenticated surface should be on our most expensive model at all.

**2.3 Centralise the stray model literals.** Nine `eu.anthropic.*` literals live
outside `provider.ts` (`value-map/reveal:8`, `demo/reading:238,251,260`,
`generate-archetype:14`, `balance-sheet-screenshot:17`, `balance-sheet-pdf:20`,
`screenshot:48`, `regenerate-archetype:17`). **This is a hard prerequisite for
Phase 4** — a swap driven by env vars silently misses every one of them.

Add an `opusModel` handle too: `opusModelId` is exported but never imported, so
call sites re-read the env var and defaults can drift
(`audit/dead-code.md:76` already flags this).

---

## Phase 3 — Cost observability

We cannot claim a saving we cannot measure, and today chat writes no rows to
`llm_usage_log` at all.

**3.1 Migration:** add `cache_read_tokens`, `cache_write_tokens`, and
`estimated_cost_usd` to `llm_usage_log`. Staging only — **production migrations
require Lewis's approval** per `CLAUDE.md`.

**3.2 Log chat usage.** Write a row per chat turn (currently only `tool_call`
rows exist, with tokens deliberately nulled). Reuse the existing `after()` pattern
so it stays off the response path.

**3.3 Pricing table in code.** A single `lib/ai/pricing.ts` keyed by model ID —
input, output, cache-read, cache-write rates. Makes cost a computed field rather
than a spreadsheet exercise, and makes the Phase 4 comparison mechanical.

**3.4 Widen the telemetry types.** `usage-logger.ts:3` types model as
`'sonnet' | 'haiku' | 'opus'` — this **will not compile** once Nova lands.
`chat/route.ts:754` hardcodes `model: 'claude-sonnet-4-6'` in the log payload and
must derive from `chatModelId`.

---

## Phase 4 — Nova Pro, staged

### 4a. Utility tier first *(low risk, real saving)*

Nova Pro undercuts Haiku, and the utility tier is close to swap-ready: no cache
point, no tool calling, flat schemas, failure fallbacks throughout.

Order by blast radius, lowest first:

1. `lib/onboarding-v2/value-map-decline-classifier.ts` — regex-pre-filtered
   yes/no. Trivially reversible.
2. `lib/analytics/chat-signals/llm-fallback.ts` — best-effort, failures swallowed.
3. `lib/categorisation/llm-categoriser.ts` — rules-first Tier 3 with a validating
   filter at `:104`; degrades to *fewer confident rows*, never wrong ones.
   Highest volume, so the biggest saving. Measurable against
   `user_merchant_rules` as ground truth.
4. `api/detect-format` + `extract-pdf-transactions` — `SESSION-LOG.md:2368`
   records Haiku format-detection as uneven, so there is **headroom in reverse**:
   Nova may improve this. `npm run parse:diagnose` measures it.

Hold back until 4b proves out: `persona-sanitiser.ts` (instruction-following-hard,
already flagged as a drift source at `SESSION-LOG.md:177`),
`free-text-opener-generator.ts` (user-facing prose), and `profile-extraction.ts`
(writes to `user_profiles` at confidence ≥ 0.7 — a weaker model does real damage
here).

**Prerequisite:** tighten loose schemas first. `portrait-extraction.ts:8-19` types
`trait_type` as a free `z.string()` with the enum only in `.describe()`, and
nothing validates the output before upsert. Convert to a real `z.enum()` —
`SESSION-LOG.md:1312` records this exact class of bug biting once already.

### 4b. Chat tier *(the actual project)*

Gate on 4a succeeding and on Phase 0.2 confirming prompt size fits the 20k cap.

**Model-capability abstraction.** Add to `provider.ts`:

```ts
export function supportsCaching(modelId: string): boolean
export function supportsForcedToolChoice(modelId: string): boolean
```

`chat/route.ts:465` and `:889` branch on these rather than assuming Anthropic.
The forced-`toolChoice` hallucination guard is the sharp edge: it is already
wrapped in try/catch (`:929`) so it degrades rather than crashes, which means it
can **fail silently** on a model that doesn't support it. Make that failure
loud — alert on it, don't swallow it.

**Persona risk is the real risk, not the plumbing.** `CFO-CONSTITUTION.md` is the
source document for voice and boundaries, and every prompt derives from it. Nova
Pro is a different model family; the persona will drift. Our guardrails, in
increasing cost:

1. `npm run test:prompts` — 9 deterministic Constitution §9 cases (9A–9I),
   substring/regex assertions, ~9 calls. Fast enough to run per-iteration.
   Currently hardcodes `chatModel` at `:35` — needs a model parameter.
2. `npm run test:onboarding` — 10 personas through the real UI, LLM-judged on 8
   hard rules + 6 Likert. The judge runs on `utilityModel`, **deliberately
   decoupled from the model under test** (`docs/superpowers/specs/2026-04-20-onboarding-test-suite-design.md:91`)
   — so it stays valid as a referee. No `--model` flag; A/B by flipping
   `BEDROCK_CLAUDE_MODEL` between runs and diffing `summary.json`.
3. `scripts/eval/` — pairwise preference with golden pairs, deterministic holdout
   folds, bootstrap CIs, champion promotion gating. Missing only a pair-*capture*
   script (the README references `scripts/compare-first-insight.ts`, which does
   not exist). Writing it makes the whole rate→calibrate→tournament loop work
   unchanged for model comparison.

**Rollout:** `BEDROCK_CLAUDE_MODEL` already exists, so staging is an env flip. Do
not ship to production on env alone — cutting back requires a redeploy. Prefer a
per-user routing flag so a bad turn is one user, not all of them.

**Explicitly out of scope:** Opus stays Anthropic. Both Opus call sites are
lifetime-once, low-volume, high-stakes (archetype reveal, demo reading) — there is
no meaningful saving and a real quality risk.

---

## Sequencing

```
Phase 0  ──► Phase 1 ──► Phase 2 ──┬─► Phase 3 ──► Phase 4a ──► Phase 4b
(gate)      (caching)   (routing)  │   (metrics)   (utility)    (chat)
                                   └─ 2.3 is a hard prereq for 4
```

Phases 1 and 2 are independent of each other and can run in parallel. Phase 3
should land before 4a so the saving is measurable rather than asserted.

Under the `CLAUDE.md` versioning convention these are separate shippable
versions — Phases 1+2 together are a natural **v2.7**, Phase 3 folds into it or
into **v2.8**, and Phase 4 is its own version with 4a and 4b likely split.

## Open questions

1. Does `@ai-sdk/amazon-bedrock@^4.0.89` support multiple system-block cache
   points? Gates the shape of 1.1.
2. Does the realistic worst-case system prompt fit Nova's 20k cache cap? Gates 4b.
3. Is Bedrock's 1-hour cache TTL available for Sonnet 4.6 / Haiku 4.5? It is
   confirmed for the 4.5 generation. Relevant to conversations with gaps beyond
   the 5-minute default, independent of Nova.
4. Is Nova Lite viable for categorisation specifically? ~7× cheaper again than
   Pro on input, and that path has a validating filter that makes degradation
   safe.

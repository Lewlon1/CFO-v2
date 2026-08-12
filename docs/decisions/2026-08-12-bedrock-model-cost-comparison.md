# Bedrock model cost comparison — DeepSeek / Llama vs Sonnet & Haiku

**Status:** Open — recommendation pending two verifications (see §7)
**Date:** 2026-08-12
**Question:** Would the cheapest viable DeepSeek / Llama models on Bedrock
meaningfully cut our model spend versus Sonnet 4.6 and Haiku 4.5, accounting for
prompt caching?

---

## 1. Answer

**Probably not, and the comparison is largely foreclosed before price enters the
picture.** Two of our own constraints eliminate most of the candidate field, and
a third makes a per-token comparison the wrong unit of measurement:

1. **EU residency.** `CLAUDE.md` states "EU inference profiles only — no data
   leaves EU", and every model ID in `provider.ts` is `eu.*`. DeepSeek on Bedrock
   appears to be published behind **`us.*` inference profiles only**
   (`us.deepseek.r1-v1:0`). If that holds, DeepSeek is excluded on residency
   grounds, not cost. **Unverified — see §7.**
2. **Prompt caching.** Bedrock prompt caching supports **Anthropic Claude and
   Amazon Nova only**. Llama and DeepSeek get none. Our chat route's economics
   depend on a cached ~9–10k-token system prompt, so a headline per-token price
   understates the true gap substantially.
3. **Tool calling.** The chat route sends **47 tool definitions** per request with
   `toolChoice: 'auto'`, `stopWhen: stepCountIs(5)`, and a forced
   `toolChoice: {type:'tool'}` retry path. Bedrock Llama/DeepSeek do not reliably
   support forced tool choice or 47-tool agentic loops. Swapping the chat model is
   a project, not a config change.

**The more useful finding:** while mapping call sites for this comparison we
found structural cost issues that are almost certainly worth more than any model
swap, and which are available to us today with no residency or capability
tradeoff. Those are §5.

---

## 2. What we run today

All verified by reading source on 2026-08-12.

| Tier | Model ID | Handle | Where |
|---|---|---|---|
| Chat | `eu.anthropic.claude-sonnet-4-6-20250514-v1:0` | `chatModel` | CFO chat (`streamText`), hallucination-guard retry, `compose-first-read`, archetype generation ×2, demo-reading fallback |
| "Analysis" | **same ID as chat** | `analysisModel` | 5 structured-extraction sites — see §5.2 |
| Utility | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` | `utilityModel` | 9 sites: categorisation, portrait/profile extraction, persona sanitiser, decline classifier, opener generator, chat-signals fallback, format detection, PDF vision |
| Opus | `eu.anthropic.claude-opus-4-6` | *(no shared handle)* | Value Map reveal; demo reading primary tier |

`provider.ts:29` is the notable line:

```ts
export const analysisModel = bedrock(chatModelId)   // ← Sonnet, not a cheaper tier
```

**We have no cost accounting anywhere in the repo.** No pricing table, no
cost-per-call computation, no dashboard. `llm_usage_log` has no cache-token and
no cost columns, and the main chat route writes no rows to it — chat cache
metrics exist only as `[bedrock-usage]` lines on stdout via
`src/lib/ai/usage-logger.ts`. That gap is why this document is qualitative where
it should be quantitative.

---

## 3. Candidate field under the EU constraint

| Model | EU inference profile | Caching | Tool calling | Vision | Verdict |
|---|---|---|---|---|---|
| Claude Sonnet 4.6 | ✅ in use | ✅ | ✅ full | ✅ | Baseline (chat) |
| Claude Haiku 4.5 | ✅ in use | ✅ | ✅ full | ✅ | Baseline (utility) |
| Claude Opus 4.6 | ✅ in use | ✅ | ✅ full | ✅ | Baseline (lifetime-once) |
| DeepSeek R1 / V3.x | ❌ `us.*` only *(unverified)* | ❌ | ⚠️ limited | ❌ R1 text-only | **Excluded — residency** |
| Llama 4 Scout / Maverick | ⚠️ unverified | ❌ | ⚠️ no forced choice | ⚠️ variant-dependent | Utility tier only, if EU-available |
| Mistral Large 3 | ⚠️ likely (EU-native vendor) | ❌ | ⚠️ partial | ❌ | Utility tier only |
| Amazon Nova Lite / Pro | ⚠️ unverified | ✅ **yes** | ✅ | ✅ | **Most interesting non-Claude option** |

Nova is the one non-Anthropic family that keeps prompt caching. If cost pressure
becomes real and Nova has EU profiles, it is a more coherent candidate than
DeepSeek or Llama precisely because it does not force us to give up the caching
our prompt architecture is built around.

### Indicative pricing — **treat as unverified**

`aws.amazon.com` and `docs.aws.amazon.com` are blocked by our sandbox egress
proxy, so these come from secondary sources that **disagree with each other**
(Llama 4 Maverick was quoted as both `$0.50/M` input and `$0.27/$0.85`). Anthropic
figures below are first-party API rates; Bedrock is partner-operated with its own
pricing and a reported ~10% premium on regional/multi-region endpoints versus
global. **Do not let these drive a decision without running §7.**

| Model | Input $/M | Output $/M |
|---|---|---|
| Claude Sonnet 4.6 | ~3.00 | ~15.00 |
| Claude Haiku 4.5 | ~1.00 | ~5.00 |
| DeepSeek V3.2 | ~0.62 | ~1.85 |
| DeepSeek R1 | ~1.35 | ~5.40 |
| Llama 4 Maverick | ~0.27–0.50 | ~0.85 |
| Llama 4 Scout | ~0.17 | — |
| Mistral Large 3 | ~0.50 | ~1.50 |
| Amazon Nova Lite | ~0.06 | ~0.24 |
| Amazon Nova Pro | ~0.40 | ~1.60 |

---

## 4. Why caching changes the comparison unit

Bedrock caching prices cache **writes at ~1.25×** base input and cache **reads at
~0.1×**. Break-even on a 5-minute TTL is two requests against the same prefix.

Our chat system prompt is assembled in `buildSystemPrompt()`
(`context-builder.ts:656`), joined with `\n\n---\n\n`. Static floor:

| Section | Source | ~chars |
|---|---|---|
| `BASE_PERSONA` | `system-prompt.ts:3-210` | ~20,200 |
| `buildToolUsageInstructions()` | `context-builder.ts:1826` | ~8,000 |
| `buildLayeredReadInstructions()` | `context-builder.ts:1017` | ~3,500 |
| `ADVISORY_BOUNDARIES` | `context-builder.ts:1555` | ~2,200 |
| posture fragment | `posture-prompts/*.ts` | ~1,400 |

**≈34–36k chars ≈ 9–10k tokens** before any per-user data. `BASE_PERSONA` alone
is ~5k tokens and is byte-identical for every user on every turn.

A Llama or DeepSeek chat swap forfeits all of this. Against an *effective* cached
Sonnet input cost the nominal per-token saving shrinks sharply — and that is
before accounting for the 47 tool schemas re-sent on each of up to 5 steps per
turn, which no non-caching model can amortise.

---

## 5. What we found that is worth more than a model swap

### 5.1 The persona block is cached per-user instead of once globally

**This is the highest-value finding in this document.**

There is exactly **one** cache point in the codebase
(`chat/route.ts:465`), attached to the end of the single concatenated system
message. The section order is identical in all three assembly branches
(`context-builder.ts:807`, `:917`, `:984`):

```ts
const sections = [
  BASE_PERSONA + styleModifier,   // ~5k tokens, only 3 variants
  buildCurrentDateContext(),      // changes once per day
  ...                             // all per-user dynamic data
].filter(Boolean);
```

Because one cache point covers the whole block, the cache entry is keyed to the
*entire* per-user prompt. The ~5k-token persona prefix — identical across every
user in the system, with only **three** register variants (blunt / gentle /
direct, `context-builder.ts:783-791`) — is **never shared across users or
conversations**. Every user's first turn in every conversation re-writes it at
~1.25×.

Bedrock supports up to 4 cache points. A second cache point placed immediately
after `BASE_PERSONA + styleModifier` would collapse that to at most three
globally shared cache entries, leaving the per-user tail on its own breakpoint.

*Correction on the record:* an earlier read of this suspected
`buildCurrentDateContext()` was busting the cache on every turn. It is not — it
emits a **date only** (`toISOString().slice(0,10)`), so it invalidates once per
day at UTC rollover, not per turn. Within a conversation the cache behaves as
designed. The sharing gap above is the real issue.

### 5.2 Five extraction call sites pay Sonnet prices for Haiku work

`analysisModel` is `bedrock(chatModelId)` — Sonnet. Consumers:

- `src/lib/parsers/screenshot.ts:32` — bank-statement screenshot → transactions
- `src/lib/parsers/balance-sheet-screenshot.ts:30`
- `src/lib/parsers/balance-sheet-pdf.ts:74`
- `src/lib/parsers/bill-extractor.ts:103`
- `src/lib/ai/tools/search-bill-alternatives.ts:146` — nested inside a chat tool

This is exactly the "structured extraction where personality/nuance doesn't
matter" category `CLAUDE.md` assigns to `utilityModel`. Vision quality on Haiku
needs checking before moving the three image/PDF sites, but
`search-bill-alternatives` is text-only and should move regardless. Expected
saving on these paths is ~3× input / ~3× output.

### 5.3 An unauthenticated public endpoint runs on Opus

`src/app/api/demo/reading/route.ts:251` hardcodes
`bedrock('eu.anthropic.claude-opus-4-6')` with **no env override**, on a public
pre-signup demo route, falling back to Sonnet on failure. This is our most
expensive model on our least access-controlled surface, and it cannot be
retargeted without a code change.

### 5.4 The hallucination-guard retry is uncached and over-tooled

`chat/route.ts:889` re-sends the full system prompt via top-level `system:` —
**no cache point** — plus all 47 tools, to force a single
`record_value_classifications` call.

### 5.5 Other uncached static prompts

`compose-first-read.ts` sends 6–9 KB of static system prompt uncached on every
call; each parser/extractor sends its static instruction block uncached.

### 5.6 Tool-schema cache placement is unverified

The cache point is on the system message; `tools` is a sibling top-level
parameter of `streamText`. On the Converse API, tool config renders ahead of
system. If the 47 schemas fall outside the cached prefix, they are a large fixed
uncached cost on every request and every one of up to 5 steps. There is no
`cachePoint` in the `tools` object anywhere in the repo. **Measure before
optimising anything else.**

---

## 6. Recommendation

Ranked by value per unit of effort. None of items 1–5 involve a residency or
capability tradeoff.

| # | Action | Effort | Confidence |
|---|---|---|---|
| 1 | Add a second cache point after `BASE_PERSONA + styleModifier` (§5.1) | Low | High |
| 2 | Measure `cacheReadTokens` vs `cacheCreationTokens` from `[bedrock-usage]`; confirm tool-schema placement (§5.6) | Low | — |
| 3 | Move `search-bill-alternatives` to `utilityModel`; evaluate the four vision sites (§5.2) | Low | High |
| 4 | Add a cache point to the forced-retry path; trim its tool set to the one tool it forces (§5.4) | Low | Med |
| 5 | Put the demo-reading Opus call behind an env var and consider downgrading it (§5.3) | Low | High |
| 6 | Add cache-token + cost columns to `llm_usage_log`, and log chat rows | Med | — |
| 7 | *Only then* evaluate a non-Anthropic utility-tier swap | Med | Low value |

On (7): the utility tier is genuinely close to swap-ready — no cache point, no
tool calling, flat schemas, failure fallbacks throughout.
`llm-categoriser.ts` (rules-first Tier 3, validating filter at `:104`, degrades to
fewer confident rows) and `value-map-decline-classifier.ts` (regex-pre-filtered
yes/no) are the two lowest-risk candidates. `scripts/eval/` already has the
pairwise-judge machinery — golden pairs, deterministic holdout folds, bootstrap
CIs, champion promotion gating — missing only a pair-capture script. But the
saving is on our *cheapest* tier, so it should follow items 1–6, not precede them.

---

## 7. Verifications this document depends on

Neither could be completed from the Claude Code sandbox: AWS credentials there
are placeholders (`UnrecognizedClientException` from every EU region), and the
connected Supabase MCP account does not include this project.

**A. EU model availability** — settles DeepSeek and Llama definitively:

```bash
for r in eu-west-1 eu-central-1 eu-west-2 eu-west-3 eu-north-1; do
  echo "== $r =="
  aws bedrock list-inference-profiles --region "$r" \
    --query 'inferenceProfileSummaries[].inferenceProfileId' --output text | tr '\t' '\n' | sort
done
```

**B. Live pricing** — replaces the §3 table:

```bash
aws pricing get-products --service-code AmazonBedrock --region us-east-1 \
  --filters 'Type=TERM_MATCH,Field=regionCode,Value=eu-west-1' --max-results 100
```

**C. Real cache-hit ratio** — settles §5.1 and §5.6. Pull `[bedrock-usage]` lines
from Vercel function logs and compare `cacheReadTokens` against
`cacheCreationTokens` across a representative window.

Also worth checking: Bedrock now supports a **1-hour cache TTL** for Sonnet 4.5 /
Haiku 4.5 / Opus 4.5. Whether 4.6 qualifies is unconfirmed; if it does, it is
directly relevant to conversations with gaps longer than the 5-minute default.

---

## 8. Stale documentation noted in passing

`CLAUDE.md` is out of date in two places and should be corrected:

- It shows `chatModel = bedrock('anthropic.claude-sonnet-4-6-20250514-v1:0')`
  hardcoded; `provider.ts` is env-driven and `eu.`-prefixed.
- It cites `app/api/analyze-conversation/route.ts` for portrait analysis; that
  route no longer exists — the path is `lib/ai/portrait-extraction.ts` driven by
  `api/cron/portrait-extraction`.

It also describes `analysisModel` as "retained for any analysis calls that need
Sonnet quality", which reads as deliberate but is worth re-examining given §5.2.

# Product Concept Stress Test — Learnings Log

## Session 1: April 3, 2026
**User profile:** Lewis, 26-30, software developer, Barcelona, expat with cross-border finances

---

## STRENGTHS OBSERVED

### S1: Conversation beats forms for financial onboarding
The interactive form tool was built, the button broke, data was lost. The conversational fallback collected richer, more accurate data — including corrections, context, and behavioral nuances the form couldn't capture. Lewis volunteered information about his spending triggers, his relationship with money, and his girlfriend's family trip unprompted. A form would never surface "I spend when the money is there."

**Product implication:** Chat-first onboarding is not a compromise — it's the superior approach. Forms should be for structured confirmation of what the conversation already uncovered and visa versa conversation should validate and deepen understanding of what is uploaded.

---

### S2: Corrections reveal the real picture
Lewis corrected me multiple times — currency (EUR not GBP), billing frequency (bi/trimonthly gas and water), credit card purpose (pays off Revolut, not separate spending), rent already paid, and the actual April cash flow. Each correction made the advice materially better. A static tool would have just been wrong.

**Product implication:** The system needs to actively invite corrections and make them easy. Every correction should update the structured profile immediately. The conversation should periodically summarise assumptions and ask "is this right?"

---

### S3: Statement analysis surfaced things the user didn't know
Lewis believed he had a €400/month surplus. The statements showed he was actually running a deficit on regular months, bridged by bonus and double-pay months. He'd been in this pattern for five years without recognising it. The gap between perceived and actual finances is the core problem the product solves.

**Product implication:** The "aha moment" — showing users their real financial picture vs what they think it is — is the key activation event. This should happen as early as possible in the onboarding.

---

### S4: Behavioral insights emerged naturally from conversation
"I spend when money is in my account" is the single most important piece of financial advice input from the entire session. It didn't come from a slider or a quiz — it came from a follow-up question in conversation. Similarly, learning that the high dining count was mostly holiday spending changed the entire recommendation.

**Product implication:** The money psychology layer is the moat. No other finance app learns *why* you spend. The LLM should be specifically prompted to explore behavioral patterns, not just amounts, we can also leverage the value map activity results to learn this quickly before iterating conversationally.

---

### S5: Researching optimisations in real-time adds immediate value
Searching for Digi alternatives, electricity tariffs, and Revolut Metal value assessment during the conversation gave Lewis actionable savings (€50-77/month) without him having to do any research himself. This is the "plan my spending for me" model he asked for.

**Product implication:** Proactive optimisation research is a high-value feature. The system should periodically re-check bills against market rates and flag when a switch would save money.

---

### S6: The capability assessment built trust through honesty
Scoring my own confidence at 30% on tax advice (instead of pretending I could handle it) built more trust than attempting to give tax advice would have. Lewis responded with "this is amazing" — to a document that explicitly listed what I couldn't do.

**Product implication:** The product should be transparent about its limitations. When the system can't advise confidently, it should say so and route to the right resource. This is a differentiator, not a weakness.

---

## WEAKNESSES OBSERVED

### W1: Cash flow calculations lost coherence over a long conversation
I got confused about Lewis's April-June cash flow multiple times. He had to simplify the situation for me ("I see it as: I currently have no money but also no debt"). In a long conversation, accumulated context creates compounding errors in mental arithmetic.

**Product implication:** Cash flow calculations should NEVER be done by the LLM in its head. They should be computed by the system layer against the structured data model and injected into the LLM's context. The LLM interprets and advises; the system does the maths.

---

### W2: The interactive tool broke and data was lost
The React artifact's "send to Claude" button failed, and all form inputs were lost with no recovery path. Lewis had to re-enter everything conversationally.

**Product implication:** Data must be saved progressively to the database, not held in client state waiting for a submit action. Every piece of information captured should be persisted immediately. Never rely on a single "send all" action.

---

### W3: Assumptions were wrong until corrected
I assumed GBP when it was EUR. I assumed monthly billing when it was bimonthly. I assumed the credit card was separate spending when it was just the Revolut payoff mechanism. I assumed expenses were €2,300 total when the spending card alone was €2,158 on top of fixed costs.

**Product implication:** The onboarding flow should explicitly verify key assumptions before building on them. "Just to confirm — is this amount in euros or pounds?" should be a system-level check, not something the LLM might or might not think to ask.

---

### W4: No persistence between sessions
If Lewis starts a new conversation, I'd need to rely on memory summaries which lose granularity. The detailed transaction analysis, the April-June cash flow plan, the specific bill switching recommendations — all of that lives only in this conversation thread.

**Product implication:** This is the core argument for the structured data layer. Every insight, recommendation, and action item needs to be stored in Supabase and retrievable by any future conversation. The LLM should be able to query: "What did we agree Lewis's dining budget should be?" and get a definitive answer from the database.

---

### W5: Cannot initiate contact or follow up proactively
Lewis identified this himself — "proactive nudges and follow-ups" as a gap. I can't remind him to switch his Digi plan, check if he transferred money on payday, or alert him when a bill increased unexpectedly. All engagement is user-initiated.

**Product implication:** The system layer needs a notification/nudge engine. Rules-based triggers (payday detected → remind to transfer savings) and scheduled reviews (first of month → generate spending summary) running as cron jobs or triggered by transaction webhooks.

---

### W6: Manual CSV upload is too much friction for ongoing use
Lewis explicitly rejected the manual expense logging approach ("realistically I'm not going to do it"). CSV upload monthly is better but still requires effort. The product needs automatic transaction ingestion.

**Product implication:** Bank API integration (Open Banking / PSD2 in Europe) is essential for the product to work at scale. For MVP, CSV/screenshot upload with a dead-simple flow (drag and drop, auto-detect format) is the minimum. Plaid, TrueLayer, or Salt Edge for the European market.

---

### W7: Research results are point-in-time, not monitored
I searched for electricity tariffs and Digi plans today. Those results will be stale in a month. If a better deal appears next week, neither of us will know.

**Product implication:** Bill monitoring should be a background process. Periodically re-check the user's current providers against market rates. Alert when savings exceed a threshold. This is a system-layer feature that should be scheduled, not an LLM feature.

---

## OPPORTUNITIES IDENTIFIED

### O1: The "financial portrait" as core differentiator
No existing finance app builds a psychological profile of the user's relationship with money. The values ranking, spending triggers, behavioral patterns, life goals, and decision-making style create a portrait that makes every piece of advice genuinely personal. This is what makes the product defensible.

**Implementation:** A structured "financial portrait" table in Supabase that grows over time. The LLM writes to it after each conversation. It includes: values (ranked), goals (with specifics), behavioral traits (with evidence), spending patterns (with seasonal context), life circumstances, risk profile and insights gathered from value mapping.

---

### O2: The "aha moment" as activation metric
The moment Lewis saw his real surplus (deficit) vs his perceived surplus was the turning point in the conversation. This is replicable for every user: compare their stated finances with their actual transactions and show the gap.

**Implementation:** After initial onboarding (stated income and expenses) and first transaction import, automatically generate the "reality check" — a comparison of what they think vs what the data shows. This should be the first dashboard the user sees.

---

### O3: Expat / cross-border as an underserved niche
Lewis's situation — UK citizen, Spanish resident, paid in EUR, investing in GBP, UK student loan, workplace pension in Spain, ISAs in the UK — is incredibly common among expats and is terribly served by existing tools. No single app handles multi-currency, multi-jurisdiction finances well.

**Implementation:** Multi-currency support from day one. Currency of record per account. Automatic FX tracking. Jurisdiction-aware tax flagging (e.g., "you're a Spanish tax resident — your UK ISA may need to be declared"). Partnership with cross-border tax advisors.

---

### O4: Conversation history as compounding asset
Each month of conversation makes the advice better. After 12 months, the system would know Lewis's seasonal spending patterns, his real response to budget pressure, which recommendations he followed and which he ignored, and how his income has changed. This is a data moat that grows with usage.

**Implementation:** Tag and store conversation insights in structured form. Track action item completion rates. Build a "financial timeline" showing key events, decisions, and outcomes over time.

---

### O5: "Auto-pilot for the boring stuff"
Lewis doesn't want to track expenses or research bills. He wants someone to do it for him. The product should handle: automatic transaction categorisation, bill comparison, deal alerts, savings transfer reminders, and spending pattern reports — all without the user doing anything except connecting their bank account.

**Implementation:** Background processing pipeline: ingest transactions → categorise → compare against budget → flag anomalies → generate insights → deliver via push notification or chat prompt.

---

### O6: The three-month statement onboarding
The process we used today — upload 3 months of statements, get a complete analysis — is a powerful onboarding hook. It's low friction (everyone has bank statements) and high immediate value (you see your real spending picture in minutes).

**Implementation:** A "quick start" flow: connect bank or upload 3 CSVs → auto-categorise → show spending breakdown → highlight the biggest opportunities → estimate annual savings potential. All before the user has to enter any personal information beyond their statements.

---

### O7: Social spending management
Lewis's spending is heavily social — dining with friends, group trips, wedding attendance. Social spending is the hardest category to budget because it's tied to relationships and identity. A feature that helps users plan for social commitments without guilt would be genuinely novel.

**Implementation:** A "social calendar" view where upcoming events (weddings, trips, birthdays, visitors) are entered and the system adjusts the monthly budget around them. "You have a wedding in Puerto Rico in April — here's how to adjust March and May to accommodate it."

---

### O8: The credit card bridge pattern
Lewis uses his credit card to bridge cash flow gaps between regular and bonus months. This is an extremely common pattern. The product could visualise and optimise this — showing the user exactly when to pay, how much to hold back, and ensuring they never pay interest.

**Implementation:** A cash flow timeline showing income dates, bill dates, credit card due dates, and the running balance. Alerts when the user risks hitting interest charges. Automatic "pay this much on this date" recommendations.

---

## QUESTIONS TO RESOLVE THROUGH FURTHER TESTING

1. How much financial context can be injected into the LLM per conversation before quality degrades?
2. What's the right balance between chat and dashboard? When does the user want to talk vs look?
3. How do you handle conflicting advice? (e.g., "save more" vs "your values say experiences matter most")
4. What's the minimum data needed to provide genuinely useful advice? (Can we be useful from day one?)
5. How do you handle couples with shared finances? (Lewis's girlfriend came up multiple times)
6. How does the system handle users who lie about or underestimate their spending?
7. What's the right nudge frequency before it becomes annoying?
8. How do you monetise without misaligning incentives? (Financial products referrals create conflicts of interest)
9. How do you handle data security for bank credentials and financial data?


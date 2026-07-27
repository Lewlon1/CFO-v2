# Lessons

A running log of voice, positioning, and product decisions worth carrying forward.

---

## 2026-05-05 — Landing Page v4 — copy and positioning shifts

- **Time-saving promise was elevated from body to hero.** The original COPY-DECK guideline that "the time promise lives in the body, not the hero" is now superseded. Activation (the 5-second "how?" hook) outweighs aesthetic restraint. Future hero copy decisions should privilege activation when there's a tradeoff.
- **Anti-positioning is being phased out.** "Five things your CFO does that a budgeting app won't" → "Five things your CFO does for you." The product's strength is what it IS, not what competitors aren't. Voice rule: prefer positive framing throughout marketing copy.
- **Autopilot / engagement-minimising is now a fifth structural moat.** Add to COPY-DECK alongside the original four (commission-free, persistent memory, proactive, EU-native). The page's promise is that the user's finances should eventually become quiet.
- **"Free forever" is not used anywhere.** Standing rule for all future surfaces: use "free tier" framing. Preserves pricing optionality without weakening the free-tier proposition.
- **MEET · TRY · DECIDE arc is core positioning, but compressible.** The relationship arc doesn't need a full section to do its work — a one-line strip above the CTA carries the same strategic value.

---

## 2026-07-02 — Session M1: Models feature (property decision modeller) — build lessons

- **A session brief that assumes a prototype file "attached to the repo root" should be verified, not trusted, before planning starts.** The referenced `property-decision-modeller.jsx` was in neither the repo nor the conversation. Rather than reconstruct the engine from pinned golden numbers alone, the user pasted the actual prototype mid-session — its exact algorithm reproduced the brief's pinned fixture numbers by hand (78,792 / 7,199 / 689 / 133,621 / 154,996 / 111,144), confirming it was safe to port verbatim. Lesson: when a brief references an artifact "provided in context" that isn't actually there, stop and ask before writing a plan that claims fidelity to something unverified.
- **A brief's own pinned test fixture can be wrong even when its hand-derived arithmetic is right.** The Task 9 golden-test fixture for scenario 4 omitted three input fields (`new_buying_costs_pct`, `new_mortgage_rate_pct`, `new_property_appreciation_pct`) that its own hand-check comment assumed were present, because `runModel` has no implicit market-default fallback — that only exists one layer up, in `resolveValues`/`resolve.ts`. Running the fixture as literally written produced `NaN`, not the pinned numbers. An implementer subagent correctly diagnosed this as a fixture bug (not an engine bug), fixed only the fixture, and preserved every pinned assertion. Lesson: when a plan hand-derives golden numbers "by running the implementation," the fixture used for that derivation must be captured in full — a plan author's own scratch-script fixture (which merges in all market defaults automatically) can silently diverge from the literal fixture written into the plan's test code.
- **`onBlur` firing on unmount, not just on genuine blur, is a real edit-flow bug class.** `AssumptionsLedger`'s tap-to-edit ledger row used `onBlur={() => commit(slotId)}` to save on focus-loss, but React unmounting the `<Input>` after Enter/Escape already handled the field *also* fires a native blur event — causing Enter to double-commit and Escape to silently save instead of discard. Fixed by guarding `commit()` on `editingId === slotId` and giving Escape its own `cancel()` path. Lesson: any inline-edit-with-onBlur-to-save pattern needs an explicit guard against the unmount-triggered blur, not just the keyboard-triggered one.
- **Staging RLS migrations should be verified with `set_config('request.jwt.claims', ...)` + `set local role authenticated`, not by trusting `apply_migration` success.** Exact working sequence (staging project `qlbhvlssksnrhsleadzn` only):
  ```sql
  select set_config('request.jwt.claims', json_build_object('sub', '<user_a_id>')::text, true);
  set local role authenticated;
  insert into public.model_runs (user_id, decision_type, schema_version, defaults_version)
  values ('<user_a_id>', 'property', 1, '2026-Q2-illustrative');

  select set_config('request.jwt.claims', json_build_object('sub', '<user_b_id>')::text, true);
  set local role authenticated;
  select count(*) as visible_to_b from public.model_runs where user_id = '<user_a_id>';
  -- expect 0
  ```
  Note `execute_sql` only surfaces the *last* statement's result per call — split the read half into separate calls (each re-issuing `set_config` immediately before its own `select`) to see both numbers. This was independently reproduced twice in this session with two different real user pairs, both giving `visible_to_b = 0` / `visible_to_a = 1`.
  - **A brief's example migration SQL can target the wrong FK.** The session brief's draft SQL referenced `auth.users(id)`; every migration in the repo from the last ~2 months (`063`, `065`, `066`, `067`) FKs `user_id` to `public.user_profiles(id)` instead. Grepping recent migrations for the actual house convention before writing new DDL caught this before it shipped.
- **A route with a static `page.tsx` sibling to a `[dynamicSegment]` folder (e.g. `/office/models` + `/office/models/[runId]`) 404s under `next dev` (Turbopack) in this sandboxed `.claude` worktree environment, even after clearing `.next` and restarting fresh — while every other `(office)/office/<slug>` route (none of which have this exact pattern) serves fine on the same server, and a full `next build` correctly lists and compiles the route.** Confirmed not a code defect: `npx tsc --noEmit` clean, full `npm run test` (1175/1175) green, `npm run build` lists `/office/models` and `/office/models/[runId]` identically to working siblings. This is the first route in the app with this static+dynamic-sibling shape, so it's untested territory for this specific dev-tooling/sandbox combination. Live interactive click-through verification for this feature could not be completed in-session; recommend verifying in a normal local `npm run dev` outside the sandboxed worktree, where this is very likely to just work given the clean production build.

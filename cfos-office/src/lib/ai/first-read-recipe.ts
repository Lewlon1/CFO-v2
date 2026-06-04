/**
 * First Read LEAD selector.
 *
 * Pure function. Decides which of four leads the Read opens with, keyed off the
 * goal/entry_struggle the onboarding flow already captured. It only sets the
 * lead emphasis — all five layers still compose (see docs/the-layers.md). The
 * hook close stays for every recipe.
 *
 * Precedence mirrors resolveUserIntent() in insight-engine.ts (goal first, then
 * entry_struggle). It does NOT change that function; it adds a 'dont_know' →
 * 'visibility' mapping that resolveUserIntent treats as null, because the
 * literal "I don't know where my money goes" picker is exactly the signal the
 * visibility lead exists to serve.
 */

export type ReadRecipe = 'visibility' | 'target' | 'control' | 'open';

export type RecipeInput = {
  goal: { name: string; target_amount: number | null; target_date: string | null } | null;
  entryStruggle: string | null; // dont_know | debt | wealth | planning | free_text | null
  entryStruggleText: string | null;
};

export function selectReadRecipe(i: RecipeInput): ReadRecipe {
  // 1. A concrete target (amount AND date) is the strongest signal — lead with the gap.
  if (i.goal?.target_amount != null && i.goal?.target_date != null) return 'target';

  // 2. Otherwise route by the captured entry struggle.
  switch (i.entryStruggle) {
    case 'dont_know':
      return 'visibility';
    case 'debt':
      return 'control';
    case 'wealth':
    case 'planning':
      return 'target'; // target intent w/o a number → BLOCKER leads ("set a target")
    case 'free_text':
      return classifyFreeText(i.entryStruggleText);
    default:
      return 'open';
  }
}

// Deterministic keyword heuristic only this session. A Haiku fallback for
// ambiguous free-text is a LOGGED FOLLOW-UP, not built here (keeps this a pure
// function with no hot LLM call in the one-shot path).
function classifyFreeText(text: string | null): ReadRecipe {
  const t = (text ?? '').toLowerCase();
  if (!t) return 'open';
  if (/\b(where|going|track|see|understand|breakdown|visib)/.test(t)) return 'visibility';
  if (/\b(debt|owe|credit card|loan|pay\s?off|clear)/.test(t)) return 'control';
  if (/\b(save|invest|deposit|house|retire|portfolio|target|goal|wealth)/.test(t)) return 'target';
  return 'open';
}

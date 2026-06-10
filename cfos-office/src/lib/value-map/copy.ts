// Single source of truth for Value Map "significance" copy.
// Used by the demo welcome/explainer/reveal surfaces and by the
// onboarding Value Map intro. See docs/design/value-map-significance-mockup.md.

export const VALUE_MAP_INTRO_HERO = 'Your Value Map' as const

// Three rotating subheads, one per promise. Pick one at random on mount
// (see useRotatingSubhead below) so returning visitors see a different angle;
// the 3-bullet block always surfaces all three promises regardless.
export const VALUE_MAP_INTRO_SUBHEADS: readonly string[] = [
  // Primary — echoes the hero "see the gap" promise
  "Two minutes to show me what your money is really for. Then we can see the gap — and close it without touching what matters.",
  // Secondary A — framework vocabulary used directly (no softening)
  "Show me your Foundations and your Leaks. I'll know what to protect and where to look.",
  // Secondary B — ties to the "building toward" positioning
  "Tell me what you're building toward. I'll help make sure your numbers line up.",
] as const

export interface IntroBullet {
  title: string
  body: string
}

export const VALUE_MAP_INTRO_BULLETS: readonly IntroBullet[] = [
  {
    title: 'Save without sacrifice.',
    body: 'Your Foundations and Investments stay protected. Room to save lives in the Leaks.',
  },
  {
    title: 'Personal from minute one.',
    body: 'Every suggestion I make is shaped by what you tell me now.',
  },
  {
    title: 'Sharper every conversation.',
    body: 'A starting sketch. It gets clearer every time we sit down.',
  },
] as const

// Explainer used on the onboarding Value Map intro. Frames *what* the Value
// Map is (a different way to look at money) and *why* it works (optimise
// without sacrificing what matters), before the user sees the four buckets
// below. Distinct from VALUE_MAP_INTRO_BULLETS — those are product promises
// used on the demo/marketing surfaces.
export const VALUE_MAP_INTRO_EXPLAINER: readonly IntroBullet[] = [
  {
    title: 'A different way to look at money.',
    body:
      'Most budgets ask how much you spend. The Value Map asks what your spending is for — so we can talk about your money in terms of what it means to you, not just numbers.',
  },
  {
    title: 'Save without sacrificing what matters.',
    body:
      "Once I know which spending protects your life and which slips through it, I know where to look — and where to leave alone. The room to save lives in the things you won't miss.",
  },
] as const

// How the onboarding Value Map exercise actually works. Sets expectations
// about samples seeding a baseline that sharpens with real statements over
// time. The Unsure entry was previously here; it now lives alongside the
// quadrants in VALUE_MAP_INTRO_UNSURE_BUCKET since it's conceptually a fifth
// option, not a mechanics note.
export const VALUE_MAP_INTRO_HOW: readonly IntroBullet[] = [
  {
    title: "You'll start with samples.",
    body:
      "The transactions on the next screen aren't yours — they're representative examples. Sort them by what they mean to you and I'll build a baseline reading. You can re-do this with your own statements whenever you want, and the reading sharpens every time.",
  },
] as const

// Fifth "bucket" rendered alongside the four quadrants. Visually de-emphasised
// vs Foundation/Investment/Burden/Leak — it's the escape hatch, not a
// category. Copy emphasises that Unsure is a signal in its own right: it
// tells the CFO where the user is still working things out.
export const VALUE_MAP_INTRO_UNSURE_BUCKET = {
  emoji: '❔', // ❔
  name: 'Unsure',
  tagline: 'Honestly not sure',
  description:
    "Better than forcing a guess. Where you tap Unsure tells me where you're still working things out — and those are some of the most useful things for us to talk about later.",
} as const

export const VALUE_MAP_DEMO_FOOTNOTE =
  'Takes about 2 minutes. No account needed to see your reading.'

// Quadrant explainer ---------------------------------------------------------

export const EXPLAINER_HEADING = 'How this shapes what I do'
export const EXPLAINER_SUBHEAD = 'Four buckets. Trust your gut — we can refine later.'

export function getQuadrantCfoTagline(quadrantId: string): string {
  const taglines: Record<string, string> = {
    foundation: "I'll protect these.",
    investment: "I'll help you grow these.",
    burden: "I'll look for cheaper ways.",
    leak: 'This is where we find money.',
  }
  return taglines[quadrantId] ?? ''
}

// Demo reveal — CFO hook message that types in after the shareable card.
export function buildDemoRevealHook(displayName: string): string {
  const opener = displayName ? `${displayName}, that's the sketch.` : "That's the sketch."
  return (
    `${opener} You've told me what matters and what doesn't — which means I now ` +
    "know what to protect and where to look for money. Bring me your real " +
    "spending and I'll show you exactly where your numbers match what you just " +
    'said, and where they don\u2019t. That gap is where most of the wins live — ' +
    'money you can free up without touching the things you actually care about. ' +
    'This reading gets sharper every month we talk.'
  )
}

// Payoff panel (pre-signup) -------------------------------------------------

export const PAYOFF_PANEL = {
  heading: 'What changes when you sign up',
  bullets: [
    {
      title: 'The Gap',
      body:
        "Upload a statement and I'll show you, line by line, where your actual spending matches what you just told me — and where it doesn't.",
    },
    {
      title: 'Cuts without sacrifice',
      body:
        'I find the money in your Burdens and Leaks first. Your Foundations and Investments are off-limits unless you say otherwise.',
    },
    {
      title: 'A reading that sharpens',
      body:
        "Every conversation, every statement, every correction makes me better at helping you. This isn't a static profile.",
    },
  ],
  closingLine:
    'Your reading stays yours whether you sign up or not. But this is where it starts earning its keep.',
} as const

// Sketched Gap insight placeholder (shown under bullet 1 of the payoff panel).
// Uses placeholder numbers; footnote makes clear the real version uses the
// user's own data.
export interface GapSketchCopy {
  currencySymbol: string
  monthlyAmount: number
  dormantDays: number
  annualPhrase: string
  comparison: string
}

export function buildGapSketchCopy(country: string): GapSketchCopy {
  const isSpain = country === 'ES'
  return {
    currencySymbol: isSpain ? '\u20AC' : '\u00A3',
    monthlyAmount: 50,
    dormantDays: 47,
    annualPhrase: isSpain ? '\u20AC600/year' : '\u00A3600/year',
    comparison: isSpain ? "we've freed a weekend in Porto" : "we've freed a flight to Lisbon",
  }
}

export const GAP_SKETCH_FOOTNOTE = 'Your version uses your real numbers.'

// ── VM-3: post-Read card session (real transactions) ─────────────────────────
// Constitution check: short declarative sentences, no service-desk register,
// no hype. The session asks the one question the Read can't answer alone.

export const VM3_INTRO_HEADING = 'Your call on each of these' as const

export const VM3_INTRO_BODY =
  "The Read showed what your money does. It can't know what it's for — that part is yours. Sort these and every answer reaches the matching transactions across your whole history." as const

export const VM3_INTRO_CTA = 'Start sorting' as const

/** Skip affordance — shown at session start and on every card. */
export const VM3_SKIP_LABEL = 'Later' as const

export const VM3_SAVING_LABELS: readonly string[] = [
  'Carrying your answers through your history…',
  'Re-reading every matching transaction…',
] as const

export const VM3_PAYBACK_HEADING = 'That just paid off' as const

/** Renders as: "{answers} answers. {mapped} transactions mapped." */
export function vm3PaybackSummaryLine(answers: number, mapped: number): string {
  return `${answers} answer${answers === 1 ? '' : 's'}. ${mapped} transaction${mapped === 1 ? '' : 's'} mapped.`
}

/** Renders as: "{amount} a month now carries your values." */
export const VM3_PAYBACK_MONTHLY_SUFFIX = 'a month now carries your values.' as const

export const VM3_PAYBACK_CTA = 'On to your goals' as const

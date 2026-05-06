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

// ── Post-onboarding welcome copy & chip definitions ────────────────────────
// Revised 2026-04-22 per UX copy audit against the copy deck.

export interface WelcomeCopyInput {
  archetypeName: string
  archetypeSubtitle: string
  monthsPhrase: string | null
}

export interface WelcomeParagraphs {
  opening: string
  transition: string
  whatItIs: string
  shareMore: string
  useCases: string
  invitation: string
}

export function formatMonthsPhrase(months: number): string | null {
  if (months <= 0) return null
  if (months === 1) return 'a month'
  if (months === 2) return 'two months'
  if (months === 3) return 'three months'
  return `${months} months`
}

export function buildWelcomeCopy(input: WelcomeCopyInput): WelcomeParagraphs {
  const { archetypeName, archetypeSubtitle, monthsPhrase } = input

  const opening = monthsPhrase
    ? `You’re **${archetypeName}** — ${archetypeSubtitle}. That’s the lens I’ll use from here. With ${monthsPhrase} of your spending in front of me, I already know what to protect and where to look.`
    : `You’re **${archetypeName}** — ${archetypeSubtitle}. That’s the lens I’ll use from here. Every suggestion I make will pass through it.`

  const transition = monthsPhrase
    ? `The more of your life I can see, the sharper I get.`
    : `Right now I’m working from what you told me, not what your bank shows. The more I can see, the sharper I get.`

  const whatItIs = `Here’s what this place is. I’m not a budgeting app. I won’t ping you when you overspend on coffee, and I won’t make you fill in spreadsheets. I’m a CFO — I look at your real numbers, spot what you can’t see from the inside, and help you make the calls that move you forward.`

  const shareMore = `Other accounts, credit cards, bills I haven’t seen yet — that’s where the gaps usually hide. Show me what you pay for electricity, internet, or your phone and I can often find you a better deal within minutes.`

  // Cut: the "reasons people come" paragraph duplicated content from the
  // capabilities beat and the chips below. Empty string renders nothing.
  const useCases = ``

  const invitation = `**What’s on your mind today?**`

  return { opening, transition, whatItIs, shareMore, useCases, invitation }
}

// ── What-the-CFO-helps-with topics ─────────────────────────────────────────

export interface WelcomeTopic {
  id: string
  category: string
  question: string
}

export const WELCOME_TOPICS: WelcomeTopic[] = [
  {
    id: 'everyday',
    category: 'Everyday money management',
    question: 'Where does it all go — and am I paying too much for any of this?',
  },
  {
    id: 'planning',
    category: 'Planning & goals',
    question: 'What am I actually building toward — and is what I’m doing getting me there?',
  },
  {
    id: 'advisory',
    category: 'Ongoing advisory',
    question: 'What did we agree last time — following up on experiments?',
  },
  {
    id: 'investing',
    category: 'Investing & wealth building',
    question: 'Should this money be doing more?',
  },
  {
    id: 'life-events',
    category: 'Life events & protection',
    question: 'Plan a trip or what happens if…?',
  },
]

export const CHAT_OPENERS = {
  debt: `Clearing debt is mostly arithmetic, once we can see the pieces. Tell me what you're carrying — type, roughly how much, and what rate you're paying. We'll go from there.`,

  wealth: `Building wealth covers a lot of ground — pensions, ISAs, property, a business of your own. Before I say anything actually useful, I need to know where you're starting. What's already working? And what's the bit you keep meaning to do?`,

  planning: `Tell me what you're planning. The more specific the better — a wedding next October, a sabbatical in 18 months, a deposit in two years. Once I know what you're aiming at, we can look at how to get there from where you are.`,
} as const

export type FixedOpenerKey = keyof typeof CHAT_OPENERS

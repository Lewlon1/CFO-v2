export const INTRO_HEADLINES: Record<string, string> = {
  dont_know:
    "Most months, you don't know where it goes. That's the easy place to start.",
  debt:
    "Clearing what you owe is mostly arithmetic. The first step is seeing the money that's already moving through your account.",
  wealth:
    "Building wealth starts with what you keep. Let's see what your money's actually doing first.",
  planning:
    "Before you can plan for what's next, we need a clear picture of what's leaving the account each month.",
  free_text:
    "Whatever's on your mind, the leverage is in your day-to-day spending. Let's start there.",
}

export function getIntroHeadline(entryStruggle: string | null): string {
  if (!entryStruggle) return INTRO_HEADLINES.dont_know
  return INTRO_HEADLINES[entryStruggle] ?? INTRO_HEADLINES.dont_know
}

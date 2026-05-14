export function buildFreeTextOpenerPrompt(userText: string): string {
  return `The user has just signed up. As their first interaction, in response to "Where do you struggle most with your money?" they wrote:
"${userText}"

Respond as the CFO — direct, warm, no advice yet. Constraints:
- Acknowledge what they said specifically (not "Got it" generically)
- Ask one clarifying question to understand their situation
- Do not give advice
- Do not assume their numbers, country, family, or context
- Apply the standard advisory boundary (no product recommendations, no buy/sell calls)
- Keep it under 60 words

Return only the response text. No preamble.`
}

export const FREE_TEXT_OPENER_FALLBACK =
  `Got it. Tell me a bit more about what brought you in — what's been on your mind, and how long has it been bothering you?`

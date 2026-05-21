/**
 * Hypothesis engine variant selection.
 *
 * Unlike isChatIntelligenceV2Enabled (which has graduated to default-on),
 * the hypothesis engine is a SECOND prompt variant compared head-to-head
 * against the v2 baseline in the rating tool. There is no cohort gate.
 *
 * - HYPOTHESIS_ENGINE_PROMPT=1 — render the v2_hypothesis variant in chat
 * - HYPOTHESIS_ENGINE_GENERATE=1 — generate + persist hypotheses on
 *   upload / value-map completion. Implied by HYPOTHESIS_ENGINE_PROMPT=1
 *   (no point rendering without generating).
 */
export function shouldUseHypothesisPromptVariant(): boolean {
  return process.env.HYPOTHESIS_ENGINE_PROMPT === '1'
}

export function shouldGenerateHypothesisOnUpload(): boolean {
  return (
    process.env.HYPOTHESIS_ENGINE_GENERATE === '1' ||
    process.env.HYPOTHESIS_ENGINE_PROMPT === '1'
  )
}

// ── Demo analytics ──────────────────────────────────────────────────────────
//
// Console-logged events for now. Replace with proper analytics (Posthog,
// Mixpanel, etc.) when traffic justifies it.
//
// Key funnel metric: demo_finished → demo_email_submitted conversion rate

type DemoEvent =
  | 'demo_started'
  | 'demo_card_completed'
  | 'demo_finished'
  | 'demo_reading_generated'
  | 'demo_reading_fallback'
  | 'demo_card_saved'
  | 'demo_email_submitted'
  | 'demo_email_failed'
  | 'demo_resonance_rated'

export function demoAnalytics(event: DemoEvent, data?: Record<string, unknown>) {
  console.log(`[demo] ${event}`, data ?? '')
}

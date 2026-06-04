// Whether internal QA guard-rail notes (first-read validator corrections, the
// value-save "didn't persist" safety net) may be appended to user-facing
// message bodies.
//
// These are dev-time diagnostics, NOT product copy — see appendCorrection in
// lib/ai/insight-validator.ts ("not a user-facing UI"). They leaked to
// production users (S-user-journey), so they are now suppressed in prod and
// kept only in non-production, or when explicitly forced via SHOW_QA_NOTES=true
// (e.g. eyeballing staging). Telemetry (user_events) fires regardless of this
// gate — only the user-visible text is conditional.
export function showInternalQANotes(): boolean {
  if (process.env.SHOW_QA_NOTES === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

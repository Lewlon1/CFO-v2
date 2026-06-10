// Whether internal QA guard-rail notes (first-read validator corrections, the
// value-save "didn't persist" safety net) may be appended to user-facing
// message bodies.
//
// These are dev-time diagnostics, NOT product copy — see appendCorrection in
// lib/ai/insight-validator.ts ("not a user-facing UI"). They leaked to
// production users once (S-user-journey) and then again to real testers on
// STAGING, because the old gate showed them in any non-production env
// (NODE_ENV !== 'production'). The default is now OFF everywhere — they appear
// only when explicitly forced via SHOW_QA_NOTES=true (e.g. a local dev session).
// Telemetry (user_events) fires regardless of this gate — only the user-visible
// text is conditional.
export function showInternalQANotes(): boolean {
  return process.env.SHOW_QA_NOTES === 'true';
}

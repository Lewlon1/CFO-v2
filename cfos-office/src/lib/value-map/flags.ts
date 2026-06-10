// VM-3 — feature flag for the post-Read Value Map card session.
//
// Repo convention is env-var switches (the retired LAYERED_READ_DISABLED /
// CHAT_INTELLIGENCE_V2_FORCE pattern); there is no flag registry. Server-side
// only — the value-map page reads it and threads a boolean to the client.
//
// Default OFF: the live cohort keeps the existing value-first flow until the
// final merge decision. Set VALUE_MAP_V2=1 to enable.

export function isValueMapV2Enabled(): boolean {
  return process.env.VALUE_MAP_V2 === '1'
}

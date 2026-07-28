// VM-3 — feature flag for the post-Read Value Map card session.
//
// Repo convention is env-var switches (the retired LAYERED_READ_DISABLED /
// CHAT_INTELLIGENCE_V2_FORCE pattern); there is no flag registry. Server-side
// only — the value-map page reads it and threads a boolean to the client.
//
// Default ON as of the v2.9 synthesis branch, so VM v2 (deterministic candidate
// selection, archetype reveal, payback screen, Alignment Score tile,
// PlanProvenance) is actually exercised in testing rather than sitting inert.
//
// Set VALUE_MAP_V2=0 to fall back to the v1 value-first flow. The v1 path is
// unchanged and still fully wired, so the opt-out is a real escape hatch, not a
// stub — every one of the 9 call sites branches on this single function.
//
// NOTE: this default is deliberately provisional. If VM v2 ships for real, fold
// the flag away entirely rather than leaving an inverted switch behind.

export function isValueMapV2Enabled(): boolean {
  return process.env.VALUE_MAP_V2 !== '0'
}

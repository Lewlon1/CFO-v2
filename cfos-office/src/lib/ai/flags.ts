// First Read validator posture — on/off switch for the regenerate.
//
// The validators on the compose path have always been log-only: a Read that
// cited a number the server never computed, or asserted headroom its own
// arithmetic contradicts, was delivered byte-identical with a console line
// behind it. The comment in compose-first-read.ts said so, and said the
// behavioural change was "better proven out via this telemetry first" — except
// the compose path wrote no telemetry at all, so there was nothing to prove it
// out with.
//
// Two things therefore ship together: the `user_events` row goes in
// UNCONDITIONALLY, so the failure rate becomes countable, and the regenerate
// sits behind this flag so it can be turned on once that rate is known. A
// regenerate is a second Sonnet call at the most expensive moment in the
// product; enabling it blind could double first-Read spend.
//
// Repo convention is env-var switches with no flag registry, so this mirrors
// `src/lib/memory/flags.ts`. Read at request time, never at module load, so one
// production build serves both arms: restart with the env set and the next
// compose takes the other path.
//
// Default OFF. Turning it on changes what users receive, and that is Lewis's
// call to make against real numbers rather than a default.
export function isReadRegenerateEnabled(): boolean {
  return process.env.FIRST_READ_REGENERATE === '1'
}

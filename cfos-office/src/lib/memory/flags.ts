// The filing cabinet — on/off switch, for measurement rather than rollout.
//
// The cabinet shipped unconditionally: the contract in tier 1, the index in
// tier 2, and three tools in the toolbox. That left no way to answer the only
// question that matters about it — does it earn the tokens it costs? — because
// there was nothing to compare against.
//
// Repo convention is env-var switches with no flag registry, so this mirrors
// `src/lib/value-map/flags.ts`. Read at request time, never at module load, so
// one production build serves both arms of an A/B run: restart with the env set
// and the next request assembles the other prompt. That matters because the
// onboarding harness has to run against `next start`, and a code-edit variant
// would cost a full rebuild per arm.
//
// Default ON — current behaviour is unchanged unless the flag is explicitly 0.
//
// Everything the cabinet contributes must move together. The contract tells the
// model reading is mandatory; the tool descriptions name the tools; the toolbox
// provides them. Gate one without the others and the model is either told to
// call a tool that no longer exists, or handed tools it was never told to use.
// The three call sites are buildStaticTier, buildToolUsageInstructions and
// buildMemoryIndexContext (context-builder.ts) plus createToolbox (tools/index.ts).
export function isMemoryFilesEnabled(): boolean {
  return process.env.MEMORY_FILES_ENABLED !== '0'
}

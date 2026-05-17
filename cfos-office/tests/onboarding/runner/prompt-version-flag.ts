/**
 * Phase 7 — Session v2.2 Chat Intelligence eval harness.
 *
 * Tiny pre-loader for the persona runner. Parses `--prompt-version v1|v2`
 * from process.argv (defaulting to v1) and:
 *
 *   1. Sets process.env.CHAT_INTELLIGENCE_V2_FORCE = '1' when v2, so the
 *      chat-intelligence-v2 feature flag check picks it up at every
 *      buildSystemPrompt call.
 *   2. Removes --prompt-version + its value from process.argv so the
 *      runner's own arg parser doesn't choke on an unknown flag.
 *   3. Prints a banner line: "[runner] prompt-version: v1" / "v2" so
 *      it's obvious in the output which side is being evaluated.
 *
 * Why a separate file rather than inline in cli.ts: the runner is in a
 * read-denied directory in this PR's working environment, so this is the
 * minimal-touch path — the user wires it into cli.ts with a single import
 * line as the FIRST import:
 *
 *   import './prompt-version-flag'  // MUST be the first import
 *   // ...rest of cli.ts as-is...
 *
 * Putting it first matters because the chat-intelligence-v2 feature flag is
 * evaluated lazily but other modules (e.g. provider.ts) read env vars at
 * module load. We don't currently depend on CHAT_INTELLIGENCE_V2_FORCE at
 * module-load anywhere, so technically import order is flexible — but
 * "first import" is the rule that won't bite later when something does.
 *
 * Alternative if you don't want to edit cli.ts: use the
 * cfos-office/scripts/run-personas-v2.ts wrapper which spawns cli.ts with
 * CHAT_INTELLIGENCE_V2_FORCE set in the subprocess env.
 */

type PromptVersion = 'v1' | 'v2'

function parsePromptVersion(): PromptVersion {
  const argv = process.argv
  const idx = argv.indexOf('--prompt-version')
  if (idx === -1) return 'v1'
  const value = argv[idx + 1]
  if (value !== 'v1' && value !== 'v2') {
    console.error(
      `[runner] --prompt-version expects "v1" or "v2", got "${value ?? '(missing)'}". Defaulting to v1.`,
    )
    // Strip the bad flag pair anyway so the runner doesn't see it.
    argv.splice(idx, value === undefined ? 1 : 2)
    return 'v1'
  }
  // Strip both the flag and the value.
  argv.splice(idx, 2)
  return value
}

const promptVersion: PromptVersion = parsePromptVersion()

if (promptVersion === 'v2') {
  process.env.CHAT_INTELLIGENCE_V2_FORCE = '1'
}

// Banner. Persona output is noisy — make this line easy to grep for.
console.log(
  `[runner] prompt-version: ${promptVersion}` +
    (promptVersion === 'v2' ? ' (CHAT_INTELLIGENCE_V2_FORCE=1)' : ''),
)

export { promptVersion }

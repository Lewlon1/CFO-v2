import Link from 'next/link'

interface Props {
  type: string
  label: string
  /**
   * When set, action-style CTAs (supply_input, cut_lever, shift_lever, reallocate_lever)
   * render as buttons that send the label back into chat as a user message. The
   * caller wires this to the same handler that fires for OPTIONS chip taps, so
   * wow_event tracking happens upstream.
   */
  onAction?: (label: string) => void
  /**
   * Fired when a navigation CTA (value_checkin, start_statement_upload) is
   * tapped. The chat sheet is a persistent fixed overlay that survives client
   * navigation, so without closing it the destination page renders UNDER the
   * still-open sheet and the tap looks like a no-op. Caller wires this to
   * closeSheet.
   */
  onNavigate?: () => void
}

const ACTION_TYPES = new Set([
  'supply_input',
  'cut_lever',
  'shift_lever',
  'reallocate_lever',
  // Delta recompose close — the directive that hands the user into chat. Tapping
  // it sends the label as the user's first turn, which the CFO acts on.
  'open_chat',
  // Onboarding goal draft — tapping sends the confirm label back as the user's
  // turn, which the CFO acts on by calling create_goal on the drafted target.
  'confirm_goal',
])

export function ChatCTA({ type, label, onAction, onNavigate }: Props) {
  // Existing surface — Value Map check-in deep-link. Behaviour preserved.
  if (type === 'value_checkin') {
    return (
      <div className="mt-3 px-3">
        <Link
          href="/value-map?mode=checkin"
          onClick={onNavigate}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl
                     bg-primary text-primary-foreground text-sm font-semibold
                     hover:opacity-90 transition-opacity min-h-11"
        >
          <span>✓</span> {label}
        </Link>
      </div>
    )
  }

  // Declared-Read close — soft pull to upload a real statement. Routes to the
  // post-onboarding cash-flow upload surface. Close the sheet on tap so the
  // upload page isn't hidden under the still-open overlay.
  if (type === 'start_statement_upload') {
    return (
      <div className="mt-3 px-3">
        <Link
          href="/office/cash-flow/upload"
          onClick={onNavigate}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl
                     bg-primary text-primary-foreground text-sm font-semibold
                     hover:opacity-90 transition-opacity min-h-11"
        >
          {label}
        </Link>
      </div>
    )
  }

  // New surfaces from the first Read's actionability close. Tap → send the
  // label as the user's next reply, so the CFO can pick up the missing input.
  if (ACTION_TYPES.has(type) && onAction) {
    return (
      <div className="mt-3 px-3">
        <button
          type="button"
          onClick={() => onAction(label)}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl
                     bg-primary text-primary-foreground text-sm font-semibold
                     hover:opacity-90 transition-opacity min-h-11"
        >
          {label}
        </button>
      </div>
    )
  }

  return null
}

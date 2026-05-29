import { notFound } from 'next/navigation'
import { StyleguideClient } from './StyleguideClient'

/**
 * Dev-only design-system surface (Visual Consistency, Phase 0c).
 *
 * Renders the *current declared system* — including its inconsistencies — by
 * reading tokens only: CSS vars via `var(--…)` + the `@/lib/tokens` exports +
 * the real primitives/molecules. It hardcodes no colour or size literal (the
 * hex-free rule enforced in `audit/visual-consistency.md`). Swatches that show
 * a "resolved" value read it live via `getComputedStyle`, so it reflects the
 * active theme.
 *
 * Guard: `notFound()` in production blocks the route at runtime. NOTE this does
 * NOT tree-shake the route out of the production bundle — true build-time
 * exclusion is a later concern, acceptable for Wave 2 internal use. The route
 * is intentionally unlinked from any nav.
 *
 * This route lives at the top level (outside the (office)/(public) route
 * groups) so it inherits the root layout — fonts, ThemeBoot, globals.css — and
 * none of the app chrome.
 */
export const metadata = { title: 'Styleguide — CFO (dev only)' }

export default function StyleguidePage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <StyleguideClient />
}

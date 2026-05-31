// Single canonical focus-visible convention for every tappable primitive.
// Visual Phase 0 (Q6) found no shared focus ring existed outside Button; this is
// now the one source. Compose it into a primitive's className via cn(..., focusRing).
// Reads only tokens: ring-ring (--color-ring) + ring-offset-background (--color-background).
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

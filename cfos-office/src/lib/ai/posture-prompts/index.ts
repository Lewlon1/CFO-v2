import { SURVIVING_POSTURE_FRAGMENT } from './surviving'
import { PLANNING_POSTURE_FRAGMENT } from './planning'
import {
  getTransformPosture,
  type PostureProfile,
} from '../../analytics/posture-helpers'

/**
 * Returns the posture-specific system prompt fragment for this user,
 * or empty string if no transform applies (stable, unknown, low confidence).
 *
 * The base system prompt is unchanged in those cases.
 */
export function getPosturePromptFragment(
  profile: PostureProfile | null | undefined,
): string {
  const transform = getTransformPosture(profile)
  if (transform === 'surviving') return SURVIVING_POSTURE_FRAGMENT
  if (transform === 'planning') return PLANNING_POSTURE_FRAGMENT
  return ''
}

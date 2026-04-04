import { calculateProfileCompleteness } from '@/lib/profiling/engine';

/**
 * Calculate weighted profile completeness (0-100).
 * Re-exports from the profiling engine for backward compatibility.
 */
export function calculateCompleteness(profile: Record<string, unknown>): number {
  return calculateProfileCompleteness(profile);
}

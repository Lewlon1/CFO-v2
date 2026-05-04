import type { Detector } from '../types'
import { highFreqMerchantDetector } from './high-freq-merchant'
import { categoryVarianceDetector } from './category-variance'
import { timePatternDetector } from './time-pattern'

export const DETECTORS: Detector[] = [
  highFreqMerchantDetector,
  categoryVarianceDetector,
  timePatternDetector,
]

export { highFreqMerchantDetector, categoryVarianceDetector, timePatternDetector }

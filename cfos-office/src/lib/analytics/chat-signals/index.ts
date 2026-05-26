export { matchPatterns, SIGNAL_PATTERNS } from './patterns';
export type { PatternMatch } from './patterns';
export { llmExtractSignals } from './llm-fallback';
export { extractAndStoreSignals } from './extract';
export type {
  ChatSignalType,
  ChatSignalExtractionMethod,
  ExtractedSignal,
  StoredChatSignal,
} from './types';

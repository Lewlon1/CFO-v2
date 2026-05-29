// Layer 4 — Conversational signals extracted from chat messages.
// See cfos-office/docs/the-layers.md.

export type ChatSignalType =
  | 'regret'           // "I shouldn't have", "regret", "wasted"
  | 'enjoyment'        // "love", "worth it", "treat"
  | 'context_person'   // "with mum", "for my partner"
  | 'context_event'    // "for [birthday]", "stag do"
  | 'context_situation'; // "after work", "stressed"

export type ChatSignalExtractionMethod = 'pattern' | 'llm';

export type ExtractedSignal = {
  signal_type: ChatSignalType;
  marker_phrase: string;
  target_merchant?: string | null;
  target_category?: string | null;
  confidence: number;
  extraction_method: ChatSignalExtractionMethod;
};

export type StoredChatSignal = {
  id: string;
  user_id: string;
  message_id: string;
  signal_type: ChatSignalType;
  target_merchant: string | null;
  target_category: string | null;
  marker_phrase: string;
  confidence: number;
  extraction_method: ChatSignalExtractionMethod;
  raw_message_text: string | null;
  created_at: string;
};

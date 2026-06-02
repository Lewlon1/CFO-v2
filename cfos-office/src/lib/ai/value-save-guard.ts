// Pure detector for the "the model said it saved a value classification but
// never called record_value_classifications" failure. Extracted from the chat
// route so it can be unit-tested in isolation.
//
// History: the old detector matched "done" in the assistant text and any
// value-category word ANYWHERE (including goal names like "Investment pot"),
// which false-fired on non-classification turns (e.g. a create_action_item
// sign-off "the conversation has done its job") and appended a confusing
// "didn't persist" note.

// "done" is intentionally excluded — too many benign sign-offs.
const SAVED_PHRASE_RE =
  /\b(saved|got it|noted|will remember|i'?ll remember|added that|reclassified|locked in)\b/i;
const VALUE_CATEGORY_RE = /\b(foundation|burden|investment|leak)\b/i;

// Write tools whose presence means a "saved/locked in" phrase refers to THEM,
// not to a value classification.
const NON_CLASSIFICATION_WRITE_TOOLS = [
  'create_action_item',
  'create_goal',
  'upsert_asset',
  'upsert_liability',
  'log_contribution',
];

export function detectValueSaveHallucination(input: {
  assistantText: string;
  lastUserText: string;
  toolsUsed: string[];
}): boolean {
  const { assistantText, lastUserText, toolsUsed } = input;

  // Classification INTENT for this turn must come from real work: the review
  // queue being open, or the USER naming a value category in their message.
  // We deliberately do NOT treat value words in the assistant text as intent —
  // goal names ("Investment pot") live there and produced false positives.
  const inValueContext =
    toolsUsed.includes('get_value_review_queue') || VALUE_CATEGORY_RE.test(lastUserText);

  const onlyNonClassificationWrites =
    toolsUsed.length > 0 && toolsUsed.every((t) => NON_CLASSIFICATION_WRITE_TOOLS.includes(t));

  const claimedSave = SAVED_PHRASE_RE.test(assistantText);
  const actuallySaved = toolsUsed.includes('record_value_classifications');

  return inValueContext && claimedSave && !actuallySaved && !onlyNonClassificationWrites;
}

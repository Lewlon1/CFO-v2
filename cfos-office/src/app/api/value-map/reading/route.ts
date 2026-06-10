import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chatModelId } from '@/lib/ai/provider'
import { logChatUsage } from '@/lib/chat/cost-tracker'
import { isValueMapV2Enabled } from '@/lib/value-map/flags'
import { STILL_READING_BLURB } from '@/lib/value-map/archetype-reading-prompt'
import { generateArchetypeReading } from '@/lib/value-map/generate-reading'
import { buildReceiptLines } from '@/lib/value-map/receipt-templates'
import type { ClassificationReceipt } from '@/lib/value-map/classify-archetype'
import {
  FAMILIES,
  type ArchetypeFamily,
  type CertaintyState,
} from '@/lib/value-map/taxonomy-config'

// POST /api/value-map/reading — VM-4's single LLM call: the 2–3 sentence
// reading for an already-classified session. The reveal renders name +
// receipt + tension immediately from the save response and fetches this
// separately, so generation latency never blocks the reveal. Hard timeout;
// on any failure the constitution-checked static blurb for the cell ships
// instead. Idempotent: a generated reading is cached on the session's
// classification_receipt and returned as-is on re-request.

interface StoredReceipt extends ClassificationReceipt {
  tension?: { type: string; line: string }
  reading?: string
  readingSource?: 'llm' | 'static'
}

export async function POST(req: NextRequest) {
  if (!isValueMapV2Enabled()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { session_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  }

  const { data: session, error } = await supabase
    .from('value_map_sessions')
    .select('id, taxonomy_version, family, certainty_state, classification_receipt')
    .eq('id', body.session_id)
    .eq('profile_id', user.id)
    .single()
  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  if (!session.taxonomy_version) {
    return NextResponse.json({ error: 'Session not classified' }, { status: 409 })
  }

  // Unnamed fallback cell — deterministic copy, no generation.
  if (!session.family || !session.certainty_state) {
    return NextResponse.json({ reading: STILL_READING_BLURB, source: 'static' })
  }

  const family = session.family as ArchetypeFamily
  const certainty = session.certainty_state as CertaintyState
  const receipt = (session.classification_receipt ?? {}) as StoredReceipt

  if (receipt.reading) {
    return NextResponse.json({ reading: receipt.reading, source: receipt.readingSource ?? 'llm' })
  }

  const lines = buildReceiptLines(family, receipt)
  const startTime = Date.now()

  const { reading, source, usage } = await generateArchetypeReading({
    family,
    certainty,
    displayName: FAMILIES[family][certainty],
    receiptHeadline: lines.headline,
    receiptBands: lines.bands,
    tensionLine: receipt.tension?.line ?? '',
  })
  if (source === 'llm') {
    void logChatUsage({
      userId: user.id,
      action: 'vm4_archetype_reading',
      model: chatModelId,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      durationMs: Date.now() - startTime,
    })
  }

  // Cache on the receipt (best effort — the response stands either way).
  const updatedReceipt: StoredReceipt = { ...receipt, reading, readingSource: source }
  const { error: updateError } = await supabase
    .from('value_map_sessions')
    .update({ classification_receipt: updatedReceipt })
    .eq('id', session.id)
    .eq('profile_id', user.id)
  if (updateError) {
    console.error('[value-map/reading] receipt cache update failed:', updateError)
  }

  return NextResponse.json({ reading, source })
}

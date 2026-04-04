import { generateObject } from 'ai';
import { z } from 'zod';
import { analysisModel } from '@/lib/ai/provider';
import { createServiceClient } from '@/lib/supabase/service';

const traitSchema = z.object({
  new_traits: z.array(
    z.object({
      trait_key: z.string().describe('Short snake_case identifier'),
      trait_value: z.string().describe('Human-readable description of the trait'),
      trait_type: z.string().describe('Category: behavioral, financial_style, personality, value_preference'),
      confidence: z.number().min(0.5).max(1.0),
      evidence: z.string().describe('Quote or paraphrase from conversation'),
    })
  ),
  suggested_follow_ups: z.array(z.string()).describe('Questions to ask in future conversations'),
});

export async function POST(req: Request) {
  // Verify internal call via secret header
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { conversation_id, user_id } = await req.json();

  if (!conversation_id || !user_id) {
    return Response.json({ error: 'Missing params' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Load conversation messages
  const { data: messages } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: true });

  if (!messages || messages.length < 4) {
    return Response.json({ skipped: true, reason: 'Too few messages' });
  }

  // Load existing traits to avoid duplicates
  const { data: existingTraits } = await supabase
    .from('financial_portrait')
    .select('trait_key, trait_value')
    .eq('user_id', user_id)
    .is('dismissed_at', null);

  const existingKeys = new Set((existingTraits ?? []).map((t) => t.trait_key));
  const existingList = (existingTraits ?? [])
    .map((t) => `- ${t.trait_key}: ${t.trait_value}`)
    .join('\n');

  // Format transcript
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'USER' : 'CFO'}: ${m.content}`)
    .join('\n\n');

  // Call Bedrock for analysis
  try {
    const { object } = await generateObject({
      model: analysisModel,
      schema: traitSchema,
      prompt: `You are analysing a conversation between a user and their personal CFO (financial advisor).
Extract any NEW behavioral traits, patterns, or profile-relevant information
that was revealed but not explicitly captured by a tool call during the conversation.

Current known traits:
${existingList || '(none yet)'}

Conversation transcript:
${transcript}

Rules:
- Only extract traits with confidence >= 0.5
- Don't duplicate existing traits listed above
- Keep trait_value concise but specific
- Return empty arrays if nothing new was found
- Focus on: spending behavior, financial attitudes, life circumstances, goals, personality traits relevant to financial advice`,
    });

    // Write new traits
    let inserted = 0;
    for (const trait of object.new_traits) {
      if (existingKeys.has(trait.trait_key)) continue;

      await supabase.from('financial_portrait').upsert(
        {
          user_id,
          trait_type: trait.trait_type,
          trait_key: trait.trait_key,
          trait_value: trait.trait_value,
          confidence: trait.confidence,
          evidence: trait.evidence,
          source: 'post_conversation',
          source_conversation_id: conversation_id,
        },
        { onConflict: 'user_id,trait_key' }
      );
      inserted++;
    }

    // Write follow-up suggestions to profiling_queue
    for (const suggestion of object.suggested_follow_ups) {
      await supabase.from('profiling_queue').insert({
        user_id,
        field: 'follow_up',
        status: 'pending',
        source: 'post_conversation',
        conversation_id: conversation_id,
      }).then(() => {
        // Store the suggestion text as a trait for reference
        if (suggestion) {
          supabase.from('financial_portrait').upsert(
            {
              user_id,
              trait_type: 'follow_up_suggestion',
              trait_key: `follow_up_${Date.now()}`,
              trait_value: suggestion,
              confidence: 0.5,
              evidence: 'Generated from post-conversation analysis',
              source: 'post_conversation',
              source_conversation_id: conversation_id,
            },
            { onConflict: 'user_id,trait_key' }
          );
        }
      });
    }

    return Response.json({
      success: true,
      traits_inserted: inserted,
      follow_ups: object.suggested_follow_ups.length,
    });
  } catch (error) {
    console.error('Post-conversation analysis error:', error);
    return Response.json({ error: 'Analysis failed' }, { status: 500 });
  }
}

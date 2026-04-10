import { generateObject } from 'ai'
import { bedrock } from '@ai-sdk/amazon-bedrock'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/chat/rate-limit'

const BEDROCK_MODEL = process.env.BEDROCK_CLAUDE_MODEL ?? 'eu.anthropic.claude-sonnet-4-6'

const extractionSchema = z.object({
  transactions: z.array(
    z.object({
      merchant: z.string().describe('Merchant or payee name'),
      amount: z.number().positive().describe('Transaction amount as a positive number'),
      date: z.string().describe('Transaction date in YYYY-MM-DD format'),
      description: z.string().nullable().describe('Additional description or reference'),
    }),
  ),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('How confident the extraction is — high means clear text, low means blurry or unclear'),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const limit = await checkRateLimit(user.id)
  if (!limit.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429 },
    )
  }

  try {
    const formData = await req.formData()
    const imageFile = formData.get('image') as File | null
    const currency = (formData.get('currency') as string) ?? 'GBP'

    if (!imageFile) {
      return Response.json({ error: 'No image provided.' }, { status: 400 })
    }

    // Convert file to Uint8Array — Bedrock doesn't support data URIs
    const arrayBuffer = await imageFile.arrayBuffer()
    const imageBytes = new Uint8Array(arrayBuffer)
    const mediaType = imageFile.type || 'image/png'

    const result = await generateObject({
      model: bedrock(BEDROCK_MODEL),
      schema: extractionSchema,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: imageBytes,
              mediaType,
            },
            {
              type: 'text',
              text: `Extract all financial transactions from this bank statement screenshot.

For each transaction, extract:
- merchant: the merchant/payee name (clean it up — remove reference numbers, keep just the name)
- amount: the transaction amount as a positive number (in ${currency})
- date: the date in YYYY-MM-DD format
- description: any additional description or null

Only extract expense transactions (money going out). Ignore income/credits.
If the image is unclear or not a bank statement, set confidence to "low" and return an empty transactions array.
If some transactions are readable but others aren't, include only the readable ones and set confidence to "medium".`,
            },
          ],
        },
      ],
    })

    return Response.json(result.object)
  } catch (err) {
    console.error('OCR extraction error:', err)
    return Response.json(
      { error: 'Failed to extract transactions from image.' },
      { status: 500 },
    )
  }
}

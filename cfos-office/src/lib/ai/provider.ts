import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'

export const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
})

const chatModelId = process.env.BEDROCK_CLAUDE_MODEL || 'eu.anthropic.claude-sonnet-4-6'
// Log the resolved model ID once at module load so cold-start logs always
// record exactly which Bedrock inference profile is in use. Misconfigured
// BEDROCK_CLAUDE_MODEL env vars previously surfaced as an opaque
// "Something went wrong" in the chat UI (Bedrock 400 ValidationException
// during streaming); this log makes the next occurrence diagnosable in one
// step via the Vercel function logs.
console.log('[bedrock] using model:', chatModelId, 'region:', process.env.AWS_REGION)
export const chatModel = bedrock(chatModelId)
export const analysisModel = bedrock(chatModelId)

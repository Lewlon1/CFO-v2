import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'

export const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
})

export const chatModelId = process.env.BEDROCK_CLAUDE_MODEL || 'eu.anthropic.claude-sonnet-4-6-20250514-v1:0'
export const utilityModelId =
  process.env.BEDROCK_CLAUDE_UTILITY_MODEL || 'eu.anthropic.claude-haiku-4-5-20251001:0'
// Log the resolved model IDs once at module load so cold-start logs always
// record exactly which Bedrock inference profiles are in use. Misconfigured
// BEDROCK_CLAUDE_MODEL env vars previously surfaced as an opaque
// "Something went wrong" in the chat UI (Bedrock 400 ValidationException
// during streaming); this log makes the next occurrence diagnosable in one
// step via the Vercel function logs.
console.log('[bedrock] chat model:', chatModelId, 'utility model:', utilityModelId, 'region:', process.env.AWS_REGION)
export const chatModel = bedrock(chatModelId)
export const analysisModel = bedrock(chatModelId)
export const utilityModel = bedrock(utilityModelId)

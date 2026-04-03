import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'

export const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
})

const chatModelId = process.env.BEDROCK_CLAUDE_MODEL || 'global.anthropic.claude-sonnet-4-6'
export const chatModel = bedrock(chatModelId)
export const analysisModel = bedrock(chatModelId)

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'

export const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
})

export const chatModel = bedrock('anthropic.claude-sonnet-4-6-20250514-v1:0')
export const analysisModel = bedrock('anthropic.claude-sonnet-4-6-20250514-v1:0')

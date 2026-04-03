export async function generateTransactionHash(
  date: string,
  amount: string,
  description: string
): Promise<string> {
  const raw = `${date}|${amount}|${description}`.toLowerCase().trim()
  const encoded = new TextEncoder().encode(raw)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

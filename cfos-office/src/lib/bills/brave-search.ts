export interface BraveSearchResult {
  title: string
  url: string
  description: string
  age?: string
}

/**
 * Search the web using Brave Search API.
 * Returns null if the API key is not configured (graceful degradation).
 */
export async function braveSearch(query: string, count = 8): Promise<BraveSearchResult[] | null> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) return null

  try {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
      text_decorations: 'false',
      search_lang: 'en',
    })

    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    })

    if (!res.ok) {
      console.error(`[brave-search] API error: ${res.status} ${res.statusText}`)
      return null
    }

    const data = await res.json()
    const results: BraveSearchResult[] = (data.web?.results || []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => ({
        title: r.title || '',
        url: r.url || '',
        description: r.description || '',
        age: r.age || undefined,
      })
    )

    return results
  } catch (err) {
    console.error('[brave-search] Request failed:', err)
    return null
  }
}

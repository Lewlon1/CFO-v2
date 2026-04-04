export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error('Failed to fetch')
    throw error
  }
  return res.json()
}

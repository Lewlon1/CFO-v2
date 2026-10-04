import { MemoryFilePage } from '@/components/office/files/MemoryFilePage'

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <MemoryFilePage folder="cashflow" slug={slug} />
}

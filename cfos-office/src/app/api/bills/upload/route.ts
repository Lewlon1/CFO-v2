import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractBillData } from '@/lib/parsers/bill-extractor'

const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/heic',
  'image/webp',
])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const formData = await req.formData()
  const billId = formData.get('bill_id') as string | null

  const files: File[] = []
  for (const [key, value] of formData.entries()) {
    if (key === 'file' && value instanceof File) {
      files.push(value)
    }
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (files.length > 1) {
    return NextResponse.json(
      { error: 'Upload one bill per request. The client should loop over files.' },
      { status: 400 }
    )
  }

  const file = files[0]
  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Accepted: PDF, PNG, JPG, HEIC, WEBP` },
      { status: 400 }
    )
  }

  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const base64 = buffer.toString('base64')
    const fileContent = file.type === 'application/pdf'
      ? base64
      : `data:${file.type};base64,${base64}`

    const result = await extractBillData([
      {
        base64: fileContent,
        fileType: file.type === 'application/pdf' ? 'pdf' : 'image',
      },
    ])

    if (!result.ok) {
      console.error('[bill-upload] Extraction failed:', result.error)
      return NextResponse.json({ error: result.error }, { status: 422 })
    }

    return NextResponse.json({
      extraction: result.extraction,
      bill_id: billId,
    })
  } catch (err) {
    console.error('[bill-upload] Unexpected error:', err)
    return NextResponse.json({ error: 'Failed to process bill' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { extractBillData } from '@/lib/parsers/bill-extractor'
import { randomUUID } from 'crypto'

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

  // Collect all files from the form (supports multiple pages of one bill)
  const files: File[] = []
  for (const [key, value] of formData.entries()) {
    if (key === 'file' && value instanceof File) {
      files.push(value)
    }
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  for (const file of files) {
    if (!ACCEPTED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Accepted: PDF, PNG, JPG, HEIC, WEBP` },
        { status: 400 }
      )
    }
  }

  try {
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const storagePaths: string[] = []
    const extractionFiles: Array<{ base64: string; fileType: 'pdf' | 'image' }> = []

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const base64 = buffer.toString('base64')

      // Upload original to Supabase Storage
      const ext = file.name.split('.').pop() || 'bin'
      const storagePath = `${user.id}/${randomUUID()}.${ext}`

      const { error: storageError } = await serviceClient.storage
        .from('bill-documents')
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: false,
        })

      if (storageError) {
        console.error('[bill-upload] Storage error:', storageError)
      } else {
        storagePaths.push(storagePath)
      }

      const fileContent = file.type === 'application/pdf'
        ? base64
        : `data:${file.type};base64,${base64}`

      extractionFiles.push({
        base64: fileContent,
        fileType: file.type === 'application/pdf' ? 'pdf' : 'image',
      })
    }

    // Extract bill data — all files treated as pages of one bill
    const result = await extractBillData(extractionFiles)

    if (!result.ok) {
      console.error('[bill-upload] Extraction failed:', result.error)
      return NextResponse.json({ error: result.error }, { status: 422 })
    }

    return NextResponse.json({
      extraction: result.extraction,
      file_path: storagePaths.length > 0 ? storagePaths[0] : null,
      file_paths: storagePaths,
      bill_id: billId,
    })
  } catch (err) {
    console.error('[bill-upload] Unexpected error:', err)
    return NextResponse.json({ error: 'Failed to process bill' }, { status: 500 })
  }
}

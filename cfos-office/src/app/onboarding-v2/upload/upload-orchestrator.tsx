'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { createClient } from '@/lib/supabase/client'
import type { Category } from '@/lib/parsers/types'
import { advanceStep } from '@/app/onboarding-v2/actions-step'

/**
 * Wraps <UploadWizard> for the Marcus journey + chat-route bridge accept.
 *
 * Mirrors <UploadBeat>'s category fetch and onDone behavior, without the
 * "I'll do this later" skip control.
 */
export function UploadOrchestrator() {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const totalImportedRef = useRef(0)
  const lastBatchIdRef = useRef<string | null>(null)
  const advancedRef = useRef(false)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('categories')
      .select('*')
      .order('name')
      .then(({ data }) => {
        if (data) setCategories(data as Category[])
      })
  }, [])

  const handleImported = useCallback((importBatchId?: string, count?: number) => {
    totalImportedRef.current += count ?? 0
    if (importBatchId) lastBatchIdRef.current = importBatchId
  }, [])

  const handleDone = useCallback(async () => {
    if (advancedRef.current) return
    advancedRef.current = true
    try {
      await advanceStep('upload_done')
    } catch (err) {
      console.error('[onboarding-v2.upload] advance failed', err)
    }
    router.push('/onboarding-v2/archetype')
  }, [router])

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex-1 flex flex-col max-w-[430px] mx-auto w-full px-4 py-6">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
          <UploadWizard
            categories={categories}
            onImported={handleImported}
            onDone={handleDone}
            context="transactions"
            autoImport
          />
        </div>
      </div>
    </div>
  )
}

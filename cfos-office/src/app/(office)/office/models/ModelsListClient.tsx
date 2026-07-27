'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'

interface RunSummary {
  id: string
  decision_type: string
  status: string
  updated_at: string
}

const DECISION_LABELS: Record<string, string> = {
  property: 'Property',
}

export function ModelsListClient({ runs }: { runs: RunSummary[] }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  const createRun = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/models/runs', { method: 'POST' })
      if (!res.ok) throw new Error('create failed')
      const { id } = await res.json()
      router.push(`/office/models/${id}`)
    } catch {
      setCreating(false)
    }
  }

  return (
    <div className="px-3.5 pt-2 pb-6 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-bold text-text-primary">Models</h1>
        <Button onClick={createRun} disabled={creating} size="sm">
          {creating ? 'Starting…' : 'New model'}
        </Button>
      </div>

      {runs.length === 0 && (
        <Card variant="inset" className="p-4 text-[13px] text-text-tertiary">
          No models yet. Start one to weigh a property decision — keep &amp; rent out, sell &amp; invest, or sell &amp; redeploy into a new home.
        </Card>
      )}

      {runs.map((run) => (
        <Card
          key={run.id}
          variant="default"
          interactive
          className="p-3 flex items-center justify-between"
          onClick={() => router.push(`/office/models/${run.id}`)}
        >
          <div>
            <div className="text-[13px] font-semibold text-text-primary">
              {DECISION_LABELS[run.decision_type] ?? run.decision_type}
            </div>
            <div className="font-data text-[10px] text-text-tertiary">
              {run.status === 'complete' ? 'Complete' : 'Interviewing'} · {new Date(run.updated_at).toLocaleDateString('en-GB')}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

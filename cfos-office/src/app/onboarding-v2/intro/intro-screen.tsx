'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ListChecks, FileUp } from 'lucide-react'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { getIntroHeadline } from '@/lib/onboarding-v2/intro-headlines'

type Props = {
  userId: string
  entryStruggle: string | null
}

export function IntroScreen({ userId, entryStruggle }: Props) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const headline = getIntroHeadline(entryStruggle)

  function handleContinue() {
    if (pending) return
    setError(null)
    startTransition(async () => {
      try {
        trackEvent('onboarding_v2.intro_continue_clicked', {
          userId,
          entry_struggle: entryStruggle ?? null,
        })
        await advanceStep('value_map_started')
        router.push('/onboarding-v2/value-map')
      } catch (err) {
        console.error('[onboarding-v2.intro] continue failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <main className="min-h-dvh flex flex-col px-6 py-10 bg-background">
      <div className="w-full max-w-md mx-auto flex-1 flex flex-col">
        <p className="eyebrow mb-8 text-center">THE CFO&apos;S OFFICE</p>

        <h1 className="text-center mb-3 font-serif text-[26px] leading-[1.18] text-foreground">
          {headline}
        </h1>

        <p className="text-center mb-8 font-sans text-[13.5px] text-muted-foreground">
          Two short steps. About seven minutes total.
        </p>

        <div className="space-y-3 mb-6">
          <StepCard
            icon={<ListChecks size={18} strokeWidth={1.6} className="text-foreground" />}
            eyebrow="STEP ONE · 5 MIN"
            title="The Value Map"
            body="Five questions, no right answers. Just your read on what matters."
          />
          <StepCard
            icon={<FileUp size={18} strokeWidth={1.6} className="text-foreground" />}
            eyebrow="STEP TWO · 2 MIN"
            title="A recent statement"
            body="CSV from your bank. Read on your device — never uploaded raw."
          />
        </div>

        <div className="px-4 py-3 mb-8 rounded-xl border border-primary/40 bg-primary/10">
          <p className="font-serif italic text-[14.5px] leading-[1.45] text-foreground">
            Then I&apos;ll show you the gap between where your money&apos;s been
            going — and where you&apos;d want it to.
          </p>
        </div>

        {error && (
          <p className="text-center mb-4 font-sans text-[13px] text-destructive">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={pending}
          className={
            'w-full transition-opacity min-h-12 rounded-xl font-sans text-[15px] font-medium ' +
            (pending
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-foreground text-background cursor-pointer')
          }
        >
          {pending ? 'Just a moment…' : 'Start the Value Map →'}
        </button>
      </div>
    </main>
  )
}

function StepCard({
  icon,
  eyebrow,
  title,
  body,
}: {
  icon: React.ReactNode
  eyebrow: string
  title: string
  body: string
}) {
  return (
    <div className="px-4 py-4 rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2.5 mb-1.5">
        {icon}
        <p className="uppercase font-sans text-[10px] tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </p>
      </div>
      <h3 className="mb-1 font-serif text-[19px] leading-[1.2] text-foreground">
        {title}
      </h3>
      <p className="font-sans text-[13.5px] leading-[1.45] text-muted-foreground">
        {body}
      </p>
    </div>
  )
}

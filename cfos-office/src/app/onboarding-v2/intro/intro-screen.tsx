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
    <main
      className="min-h-dvh flex flex-col px-6 py-10"
      style={{ backgroundColor: '#F5F1E9' }}
    >
      <div className="w-full max-w-md mx-auto flex-1 flex flex-col">
        <p
          className="uppercase mb-8 text-center"
          style={{
            fontFamily: 'var(--font-instrument-sans, sans-serif)',
            fontSize: 10,
            letterSpacing: '0.22em',
            color: '#8a8276',
          }}
        >
          THE CFO&apos;S OFFICE
        </p>

        <h1
          className="text-center mb-3"
          style={{
            fontFamily: 'var(--font-instrument-serif, serif)',
            fontSize: 26,
            lineHeight: 1.18,
            color: '#1A1612',
          }}
        >
          {headline}
        </h1>

        <p
          className="text-center mb-8"
          style={{
            fontFamily: 'var(--font-instrument-sans, sans-serif)',
            fontSize: 13.5,
            color: '#8a8276',
          }}
        >
          Two short steps. About seven minutes total.
        </p>

        <div className="space-y-3 mb-6">
          <StepCard
            icon={<ListChecks size={18} strokeWidth={1.6} color="#1A1612" />}
            eyebrow="STEP ONE · 5 MIN"
            title="The Value Map"
            body="Five questions, no right answers. Just your read on what matters."
          />
          <StepCard
            icon={<FileUp size={18} strokeWidth={1.6} color="#1A1612" />}
            eyebrow="STEP TWO · 2 MIN"
            title="A recent statement"
            body="CSV from your bank. Read on your device — never uploaded raw."
          />
        </div>

        <div
          className="px-4 py-3 mb-8"
          style={{
            border: '1px solid #C9A86A',
            borderRadius: 12,
            backgroundColor: 'rgba(201, 168, 106, 0.08)',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-instrument-serif, serif)',
              fontStyle: 'italic',
              fontSize: 14.5,
              lineHeight: 1.45,
              color: '#1A1612',
            }}
          >
            Then I&apos;ll show you the gap between where your money&apos;s been
            going — and where you&apos;d want it to.
          </p>
        </div>

        {error && (
          <p
            className="text-center mb-4"
            style={{
              fontFamily: 'var(--font-instrument-sans, sans-serif)',
              fontSize: 13,
              color: '#a04040',
            }}
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={pending}
          className="w-full transition-opacity"
          style={{
            minHeight: 48,
            borderRadius: 12,
            backgroundColor: pending ? '#D8D2C7' : '#1A1612',
            color: pending ? '#8a8276' : '#F5F1E9',
            fontFamily: 'var(--font-instrument-sans, sans-serif)',
            fontSize: 15,
            fontWeight: 500,
            cursor: pending ? 'not-allowed' : 'pointer',
          }}
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
    <div
      className="px-4 py-4"
      style={{
        backgroundColor: '#FBF8F2',
        border: '1px solid #E5DDD0',
        borderRadius: 12,
      }}
    >
      <div className="flex items-center gap-2.5 mb-1.5">
        {icon}
        <p
          className="uppercase"
          style={{
            fontFamily: 'var(--font-instrument-sans, sans-serif)',
            fontSize: 10,
            letterSpacing: '0.18em',
            color: '#8a8276',
          }}
        >
          {eyebrow}
        </p>
      </div>
      <h3
        className="mb-1"
        style={{
          fontFamily: 'var(--font-instrument-serif, serif)',
          fontSize: 19,
          lineHeight: 1.2,
          color: '#1A1612',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontFamily: 'var(--font-instrument-sans, sans-serif)',
          fontSize: 13.5,
          lineHeight: 1.45,
          color: '#5e564a',
        }}
      >
        {body}
      </p>
    </div>
  )
}

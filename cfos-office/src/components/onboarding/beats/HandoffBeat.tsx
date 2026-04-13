'use client'

interface HandoffBeatProps {
  onEnterOffice: () => void
}

export function HandoffBeat({ onEnterOffice }: HandoffBeatProps) {
  return (
    <div className="flex justify-center px-4 py-6 animate-[fade-in_0.3s_ease-out]">
      <button
        onClick={onEnterOffice}
        className="px-8 py-3.5 rounded-lg bg-[var(--accent-gold)] text-[#0F0F0D] text-base font-semibold
                   hover:brightness-110 active:scale-[0.98] transition-all min-h-[44px]
                   shadow-[0_0_20px_rgba(232,168,76,0.2)]"
      >
        Enter the Office
      </button>
    </div>
  )
}

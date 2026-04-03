import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: "The Value Map — What does your spending say about you? | The CFO's Office",
  description: '10 transactions. 2 minutes. A personality reading your bank app could never give you.',
  openGraph: {
    title: 'The Value Map — What does your spending say about you?',
    description: 'Take the 2-minute spending psychology test.',
    images: ['/demo-og.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Value Map — What does your spending say about you?',
    description: 'Take the 2-minute spending psychology test.',
    images: ['/demo-og.png'],
  },
}

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-dvh flex-col bg-background" style={{ touchAction: 'manipulation' }}>
      {/* Minimal header — logo only */}
      <header className="flex items-center justify-center py-4 px-4">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-sm bg-primary" />
          <span className="text-[15px] font-medium text-foreground">
            The <span className="text-primary">CFO&apos;s</span> Office
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col min-h-0 px-0">
        {children}
      </div>
    </div>
  )
}

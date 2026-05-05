const ITEMS = [
  ['MEET', 'Five-minute Value Map'],
  ['TRY', 'Upload a statement, see the gap'],
  ['DECIDE', 'Stay on the free tier, or upgrade when ready'],
] as const

export function JourneyStrip() {
  return (
    <div className="px-6 sm:px-10 pt-16 pb-4">
      <div className="mx-auto max-w-3xl">
        <ul className="v4-journey flex flex-col sm:flex-row sm:items-center sm:justify-center gap-3 sm:gap-0 text-center">
          {ITEMS.map(([label, text], i) => (
            <li key={label} className="flex sm:items-center">
              <span className="whitespace-nowrap">
                <span style={{ color: 'var(--ink)' }}>{label}</span>
                <span aria-hidden="true"> — </span>
                <span>{text}</span>
              </span>
              {i < ITEMS.length - 1 && (
                <span aria-hidden="true" className="hidden sm:inline px-3" style={{ color: 'var(--ink-quiet)' }}>
                  ·
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

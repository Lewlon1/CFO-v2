interface Props {
  options: string[]
  onSelect: (option: string) => void
}

export function TappableOptions({ options, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-2 mt-3 px-3">
      {options.map((option, i) => (
        <button
          key={i}
          onClick={() => onSelect(option)}
          className="w-full px-4 py-3 rounded-xl border border-border bg-card
                     hover:bg-accent active:bg-accent
                     text-sm text-foreground/80 transition-colors min-h-[44px]
                     text-left active:scale-[0.98] transform"
        >
          {option}
        </button>
      ))}
    </div>
  )
}

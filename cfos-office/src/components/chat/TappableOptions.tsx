interface Props {
  options: string[]
  onSelect: (option: string) => void
}

export function TappableOptions({ options, onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-2 mt-3 px-3">
      {options.map((option, i) => (
        <button
          key={i}
          onClick={() => onSelect(option)}
          className="px-4 py-2 rounded-full border border-border hover:bg-muted
                     text-sm text-foreground/80 transition-colors min-h-[44px]
                     text-left"
        >
          {option}
        </button>
      ))}
    </div>
  )
}

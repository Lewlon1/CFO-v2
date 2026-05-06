interface StatCardBlockProps {
  cards: Array<{ label: string; value: string }>;
}

export function StatCardBlock({ cards }: StatCardBlockProps) {
  if (cards.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 my-3 px-3">
      {cards.map((c, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-muted/40 p-3 flex flex-col gap-1"
        >
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className="text-xl font-semibold tabular-nums">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

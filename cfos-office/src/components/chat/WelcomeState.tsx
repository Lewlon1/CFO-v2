'use client';

const starters = [
  { text: "What's on your mind financially?", type: undefined },
  { text: 'Help me understand my spending', type: undefined },
  { text: 'I want to set a savings goal', type: undefined },
  { text: "What should I focus on this month?", type: undefined },
  { text: 'Help me plan a trip', type: 'trip_planning' as const },
  { text: 'What if...?', type: 'scenario' as const },
];

export function WelcomeState({
  onSelect,
}: {
  onSelect: (text: string, conversationType?: string) => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="w-14 h-14 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-5">
          <div className="w-8 h-8 rounded-sm bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg">
            £
          </div>
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">
          Welcome to the CFO&apos;s Office
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          Your personal finance advisor. What would you like to talk about?
        </p>
        <div className="grid gap-2">
          {starters.map(({ text, type }) => (
            <button
              key={text}
              onClick={() => onSelect(text, type)}
              className="w-full px-4 py-3 text-left text-sm text-foreground/80 bg-card border border-border rounded-xl hover:bg-accent hover:text-foreground transition-colors"
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

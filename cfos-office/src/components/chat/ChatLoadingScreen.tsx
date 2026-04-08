export function ChatLoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
      <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold">
        £
      </div>
      <div className="text-base font-medium text-foreground">The CFO&apos;s Office</div>
      <div className="flex gap-1.5">
        <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
      </div>
      <p className="text-sm text-muted-foreground">Your CFO is preparing…</p>
    </div>
  );
}

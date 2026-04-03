export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-hidden flex">
      {children}
    </div>
  );
}

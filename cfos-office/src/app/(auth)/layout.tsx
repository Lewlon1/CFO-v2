export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-sm bg-primary text-primary-foreground font-bold text-lg mb-4">
            £
          </div>
          <h1 className="text-xl font-semibold text-foreground">The CFO&apos;s Office</h1>
          <p className="text-sm text-muted-foreground mt-1">Your money tells a story.</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-8">
          {children}
        </div>
      </div>
    </div>
  )
}

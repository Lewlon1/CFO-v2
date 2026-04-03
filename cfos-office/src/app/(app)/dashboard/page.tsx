export default function DashboardPage() {
  return (
    <div className="flex items-center justify-center h-full px-8">
      <div className="text-center max-w-sm">
        <div className="w-12 h-12 rounded-sm bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">📊</span>
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">Financial Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Coming in Session 5 — Spending View + Values View, charts, and the Foundation/Burden/Investment/Leak breakdown.
        </p>
      </div>
    </div>
  )
}

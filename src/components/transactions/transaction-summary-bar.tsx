import type { Transaction } from "@/lib/types/database"

type Props = {
  transactions: Transaction[]
}

export function TransactionSummaryBar({ transactions }: Props) {
  const income = transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0)

  const expenses = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0)

  const net = income - expenses

  function fmt(n: number) {
    return n.toLocaleString("en", { minimumFractionDigits: 2 })
  }

  return (
    <div className="flex gap-6 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <div>
        <p className="text-xs text-muted-foreground">Income</p>
        <p className="font-semibold text-green-600 tabular-nums">+{fmt(income)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Expenses</p>
        <p className="font-semibold text-red-500 tabular-nums">-{fmt(expenses)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Net</p>
        <p
          className={
            "font-semibold tabular-nums " +
            (net >= 0 ? "text-green-600" : "text-red-500")
          }
        >
          {net >= 0 ? "+" : ""}
          {fmt(net)}
        </p>
      </div>
    </div>
  )
}

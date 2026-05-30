// Visual Phase 2d: removed dead exports (MetricTile, FolderCard/FolderMetric,
// CategoryBar, FileRow — all zero-consumer). ValuePill is KEPT: the audit marked it
// KILL, but it is live inside TransactionRow (DataComponents.tsx), which ships via
// OfficeTransactionsClient. The 6 below are consumed by TheGapClient / OfficeTransactionsClient.
export { ValuePill } from './ValuePill'
export {
  MonthSelector,
  TransactionRow,
  FilterPills,
  ProvenanceLine,
  GapCard,
  SectionTitle,
} from './DataComponents'

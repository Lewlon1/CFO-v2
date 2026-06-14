// Visual Phase 2d: removed dead exports (MetricTile, FolderCard/FolderMetric,
// CategoryBar, FileRow — all zero-consumer; GapCard/ProvenanceLine followed when
// the v1 Gap rendering was removed). ValuePill stays live inside TransactionRow
// via a direct import in DataComponents.tsx; its barrel re-export had no
// consumers. The 4 below are consumed by OfficeTransactionsClient.
export {
  MonthSelector,
  TransactionRow,
  FilterPills,
  SectionTitle,
} from './DataComponents'

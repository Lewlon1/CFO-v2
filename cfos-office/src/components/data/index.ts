// Visual Phase 2d: removed dead exports (MetricTile, FolderCard/FolderMetric,
// CategoryBar, FileRow — all zero-consumer). ValuePill stays live inside
// TransactionRow via a direct import in DataComponents.tsx; its barrel re-export
// had no consumers. The 6 below are consumed by TheGapClient / OfficeTransactionsClient.
export {
  MonthSelector,
  TransactionRow,
  FilterPills,
  ProvenanceLine,
  GapCard,
  SectionTitle,
} from './DataComponents'

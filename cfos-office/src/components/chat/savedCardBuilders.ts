import type { SavedItemCardProps } from './SavedItemCard';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

function formatCurrency(amount: number | null | undefined, currency?: string): string {
  if (amount === null || amount === undefined) return '—';
  const c = (currency || 'EUR').toUpperCase();
  const symbol = c === 'EUR' ? '€' : c === 'GBP' ? '£' : c === 'USD' ? '$' : `${c} `;
  return `${symbol}${Math.abs(amount).toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function formatFieldLabel(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString('en');
  return String(value);
}

export function buildActionItemCard(
  output: AnyRecord,
  toolCallId: string,
): SavedItemCardProps & { toolCallId: string } {
  const item = output.action_item ?? {};
  const rows: SavedItemCardProps['rows'] = [];
  if (item.title) rows.push({ label: 'Title', value: item.title });
  if (item.category) rows.push({ label: 'Category', value: formatFieldLabel(item.category) });
  if (item.priority) rows.push({ label: 'Priority', value: formatFieldLabel(item.priority) });
  if (item.due_date) rows.push({ label: 'Due', value: item.due_date });

  return {
    toolCallId,
    icon: 'check',
    title: 'Action item created',
    rows,
    undo: item.id
      ? {
          toolName: 'create_action_item',
          toolCallId,
          payload: { id: item.id },
        }
      : undefined,
  };
}

export function buildProfileUpdateCard(
  output: AnyRecord,
  toolCallId: string,
): SavedItemCardProps & { toolCallId: string } {
  const saved: string[] = Array.isArray(output.saved) ? output.saved : [];
  const savedValues: AnyRecord = output.saved_values ?? {};
  const beforeValues: AnyRecord = output.before_values ?? {};

  const rows: SavedItemCardProps['rows'] = saved.map((field) => ({
    label: formatFieldLabel(field),
    value: formatFieldValue(savedValues[field]),
  }));

  return {
    toolCallId,
    icon: 'profile',
    title: saved.length === 1 ? 'Profile updated' : 'Profile updated',
    rows,
    undo: {
      toolName: 'update_user_profile',
      toolCallId,
      payload: { fields: saved, before_values: beforeValues },
    },
  };
}

export function buildAssetOrLiabilityCard(
  toolName: 'upsert_asset' | 'upsert_liability',
  output: AnyRecord,
  toolCallId: string,
): SavedItemCardProps & { toolCallId: string } {
  const saved: AnyRecord = output.saved ?? {};
  const isLiability = toolName === 'upsert_liability';
  const action: 'created' | 'updated' = output.action === 'updated' ? 'updated' : 'created';

  const rows: SavedItemCardProps['rows'] = [];
  if (saved.name) rows.push({ label: 'Name', value: saved.name });

  const typeField = isLiability ? saved.liability_type : saved.asset_type;
  if (typeField) rows.push({ label: 'Type', value: formatFieldLabel(typeField) });

  if (saved.provider) rows.push({ label: 'Provider', value: saved.provider });

  if (isLiability) {
    if (typeof saved.outstanding_balance === 'number') {
      rows.push({
        label: 'Balance',
        value: formatCurrency(saved.outstanding_balance, saved.currency),
      });
    }
  } else {
    if (typeof saved.current_value === 'number') {
      rows.push({
        label: 'Value',
        value: formatCurrency(saved.current_value, saved.currency),
      });
    }
  }

  const titleNoun = isLiability ? 'Liability' : 'Asset';
  const title = action === 'created' ? `${titleNoun} added` : `${titleNoun} updated`;

  // Undo payload depends on action
  const undoPayload: Record<string, unknown> =
    action === 'created'
      ? { action: 'created', id: saved.id }
      : { action: 'updated', id: saved.id, before: output.before ?? null };

  return {
    toolCallId,
    icon: isLiability ? 'liability' : 'asset',
    title,
    rows,
    undo: saved.id
      ? {
          toolName,
          toolCallId,
          payload: undoPayload,
        }
      : undefined,
  };
}

export function buildValueCategoryCard(
  output: AnyRecord,
  toolCallId: string,
): SavedItemCardProps & { toolCallId: string } {
  const rows: SavedItemCardProps['rows'] = [];
  if (output.category_slug)
    rows.push({ label: 'Category', value: formatFieldLabel(output.category_slug) });
  if (output.value_category)
    rows.push({ label: 'Now classified as', value: formatFieldLabel(output.value_category) });
  if (typeof output.affected_transactions === 'number' && output.affected_transactions > 0) {
    rows.push({
      label: 'Transactions updated',
      value: String(output.affected_transactions),
    });
  }

  return {
    toolCallId,
    icon: 'category',
    title: 'Value rule saved',
    rows,
    dismissLabel: 'Got it',
    editHref: '/transactions',
  };
}

export function buildClassificationsCard(
  output: AnyRecord,
  toolCallId: string,
): SavedItemCardProps & { toolCallId: string } {
  const rows: SavedItemCardProps['rows'] = [];
  if (typeof output.classified === 'number')
    rows.push({ label: 'Transactions classified', value: String(output.classified) });
  if (typeof output.merchant_rules_created === 'number' && output.merchant_rules_created > 0)
    rows.push({ label: 'Merchant rules created', value: String(output.merchant_rules_created) });
  if (typeof output.propagated === 'number' && output.propagated > 0)
    rows.push({ label: 'Propagated', value: String(output.propagated) });

  return {
    toolCallId,
    icon: 'tx',
    title: 'Transactions classified',
    rows,
    dismissLabel: 'Got it',
    editHref: '/transactions',
  };
}

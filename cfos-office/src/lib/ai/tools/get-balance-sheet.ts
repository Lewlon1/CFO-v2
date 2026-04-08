import { z } from 'zod';
import type { ToolContext } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Asset = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Liability = Record<string, any>;

const STALE_DAYS = 90;
const REPORTABLE_TYPES: Array<{ type: string; label: string }> = [
  { type: 'savings', label: 'savings' },
  { type: 'stocks', label: 'stocks' },
  { type: 'pension', label: 'pension' },
  { type: 'property', label: 'property' },
];

export function createGetBalanceSheetTool(ctx: ToolContext) {
  return {
    description: `Retrieve the user's current balance sheet summary — all assets and liabilities with totals and net worth calculation.

WHEN TO CALL: When the user asks about their net worth, total savings, overall financial position, or when you need balance sheet context for advice (e.g., emergency fund adequacy, goal feasibility).

Returns an object with totals, per-type breakdowns, itemised lists of assets and liabilities, and a data_gaps array identifying missing asset types or stale data. Use data_gaps to naturally suggest the user share more information when contextually relevant — but never push.`,
    inputSchema: z.object({}),
    execute: async () => {
      // TODO(session-14): log to user_events
      try {
        const [assetsResult, liabilitiesResult] = await Promise.all([
          ctx.supabase
            .from('assets')
            .select('*')
            .eq('user_id', ctx.userId)
            .order('asset_type', { ascending: true })
            .order('current_value', { ascending: false, nullsFirst: false }),
          ctx.supabase
            .from('liabilities')
            .select('*')
            .eq('user_id', ctx.userId)
            .order('interest_rate', { ascending: false, nullsFirst: false }),
        ]);

        if (assetsResult.error) {
          console.error('[tool:get_balance_sheet] assets error:', assetsResult.error);
          return { error: 'Could not fetch balance sheet. Please try again.' };
        }
        if (liabilitiesResult.error) {
          console.error('[tool:get_balance_sheet] liabilities error:', liabilitiesResult.error);
          return { error: 'Could not fetch balance sheet. Please try again.' };
        }

        const assets: Asset[] = assetsResult.data || [];
        const liabilities: Liability[] = liabilitiesResult.data || [];

        const totalAssets = assets.reduce(
          (sum, a) => sum + (Number(a.current_value) || 0),
          0,
        );
        const totalLiabilities = liabilities.reduce(
          (sum, l) => sum + (Number(l.outstanding_balance) || 0),
          0,
        );
        const netWorth = totalAssets - totalLiabilities;

        const accessibleAssets = assets
          .filter((a) => a.is_accessible === true)
          .reduce((sum, a) => sum + (Number(a.current_value) || 0), 0);
        const lockedAssets = totalAssets - accessibleAssets;

        const assetsByType: Record<string, number> = {};
        for (const a of assets) {
          const t = a.asset_type || 'other';
          assetsByType[t] = round2((assetsByType[t] || 0) + (Number(a.current_value) || 0));
        }

        const liabilitiesByType: Record<string, number> = {};
        for (const l of liabilities) {
          const t = l.liability_type || 'other';
          liabilitiesByType[t] = round2(
            (liabilitiesByType[t] || 0) + (Number(l.outstanding_balance) || 0),
          );
        }

        // Build data_gaps
        const dataGaps: string[] = [];
        if (assets.length === 0 && liabilities.length === 0) {
          dataGaps.push('No balance sheet data yet');
        } else {
          for (const { type, label } of REPORTABLE_TYPES) {
            if (!assets.some((a) => a.asset_type === type)) {
              dataGaps.push(`No ${label} information yet`);
            }
          }
          const now = Date.now();
          const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
          for (const a of assets) {
            if (!a.last_updated) continue;
            const ageMs = now - new Date(a.last_updated).getTime();
            if (ageMs > staleMs) {
              const months = Math.floor(ageMs / (30 * 24 * 60 * 60 * 1000));
              dataGaps.push(`${a.name} last updated ${months} months ago`);
            }
          }
          for (const l of liabilities) {
            if (!l.last_updated) continue;
            const ageMs = now - new Date(l.last_updated).getTime();
            if (ageMs > staleMs) {
              const months = Math.floor(ageMs / (30 * 24 * 60 * 60 * 1000));
              dataGaps.push(`${l.name} last updated ${months} months ago`);
            }
          }
        }

        return {
          total_assets: round2(totalAssets),
          total_liabilities: round2(totalLiabilities),
          net_worth: round2(netWorth),
          accessible_assets: round2(accessibleAssets),
          locked_assets: round2(lockedAssets),
          assets: assets.map((a) => ({
            id: a.id,
            asset_type: a.asset_type,
            name: a.name,
            provider: a.provider,
            current_value: a.current_value !== null ? round2(Number(a.current_value)) : null,
            currency: a.currency,
            is_accessible: a.is_accessible,
            last_updated: a.last_updated,
          })),
          liabilities: liabilities.map((l) => ({
            id: l.id,
            liability_type: l.liability_type,
            name: l.name,
            provider: l.provider,
            outstanding_balance: round2(Number(l.outstanding_balance)),
            interest_rate: l.interest_rate !== null ? Number(l.interest_rate) : null,
            currency: l.currency,
            last_updated: l.last_updated,
          })),
          assets_by_type: assetsByType,
          liabilities_by_type: liabilitiesByType,
          data_gaps: dataGaps,
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:get_balance_sheet] unexpected error:', err);
        return { error: 'Something went wrong fetching the balance sheet. Please try again.' };
      }
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

import { z } from 'zod';
import type { ToolContext } from './types';
import { updateAssetPortrait } from '@/lib/balance-sheet/portrait';

const ASSET_TYPES = ['savings', 'stocks', 'bonds', 'pension', 'crypto', 'property', 'other'] as const;
type AssetType = (typeof ASSET_TYPES)[number];

const DEFAULT_ACCESSIBLE: Record<AssetType, boolean> = {
  savings: true,
  stocks: true,
  bonds: true,
  crypto: true,
  pension: false,
  property: false,
  other: true,
};

export function createUpsertAssetTool(ctx: ToolContext) {
  return {
    description: `Create or update an asset (something the user owns) when they share information about savings, investments, pensions, crypto, or property during conversation.

WHEN TO CALL: When the user mentions a balance, account, investment, pension pot, savings amount, property value, or crypto holdings — either in response to a direct question or volunteered naturally.

VALID FIELDS:
- asset_id: string (UUID) — optional. Omit for new assets. Include to update existing.
- asset_type: string — REQUIRED for new assets. One of: 'savings', 'stocks', 'bonds', 'pension', 'crypto', 'property', 'other'
- name: string — REQUIRED for new assets. Human-readable label. Examples: "Cash savings", "Vanguard S&S ISA", "Workplace Pension", "Bitcoin", "Flat in Gràcia"
- provider: string — optional. Platform or institution name.
- currency: string — optional. ISO 4217 code e.g. 'EUR', 'GBP'. Defaults to user's primary_currency.
- current_value: number — the current total value/balance.
- cost_basis: number — optional. Total amount originally contributed/invested.
- is_accessible: boolean — optional. Can they access this money quickly? Default true for savings/stocks/bonds/crypto. Default false for pension/property.
- details: object — optional. Type-specific metadata. Shape depends on asset_type:
  savings:  { interest_rate: number, is_easy_access: boolean }
  stocks:   { platform: string, account_wrapper: string }
  bonds:    { bond_type: string, yield_pct: number }
  pension:  { pension_type: 'workplace'|'private', employer_contribution_pct: number, employee_contribution_pct: number, fund_name: string, retirement_age: number }
  crypto:   { exchange: string }
  property: { purchase_price: number, is_primary_residence: boolean }

AFTER CALLING: Always confirm what you've recorded with the user in natural language. Example: "Noted — £55,000 in your Vanguard S&S ISA. Is that roughly right?"

If updating an existing asset, only include the fields that changed plus the asset_id.`,
    inputSchema: z.object({
      asset_id: z.string().uuid().optional().describe('UUID of existing asset to update. Omit for new.'),
      asset_type: z.enum(ASSET_TYPES).optional().describe('Asset type. Required for new assets.'),
      name: z.string().min(1).optional().describe('Human-readable label. Required for new assets.'),
      provider: z.string().optional(),
      currency: z.string().length(3).optional().describe('ISO 4217 currency code.'),
      current_value: z.number().min(0).optional(),
      cost_basis: z.number().min(0).optional(),
      is_accessible: z.boolean().optional(),
      details: z.record(z.string(), z.any()).optional(),
    }),
    execute: async (params: {
      asset_id?: string;
      asset_type?: AssetType;
      name?: string;
      provider?: string;
      currency?: string;
      current_value?: number;
      cost_basis?: number;
      is_accessible?: boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      details?: Record<string, any>;
    }) => {
      // TODO(session-14): log to user_events
      try {
        const nowIso = new Date().toISOString();

        // UPDATE path
        if (params.asset_id) {
          const { data: existing, error: fetchErr } = await ctx.supabase
            .from('assets')
            .select('id')
            .eq('id', params.asset_id)
            .eq('user_id', ctx.userId)
            .maybeSingle();

          if (fetchErr) {
            console.error('[tool:upsert_asset] fetch error:', fetchErr);
            return { error: 'Could not look up that asset. Please try again.' };
          }
          if (!existing) {
            return { error: 'Asset not found. It may have been deleted or belong to another user.' };
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updateData: Record<string, any> = { last_updated: nowIso };
          if (params.asset_type !== undefined) updateData.asset_type = params.asset_type;
          if (params.name !== undefined) updateData.name = params.name;
          if (params.provider !== undefined) updateData.provider = params.provider;
          if (params.currency !== undefined) updateData.currency = params.currency.toUpperCase();
          if (params.current_value !== undefined) updateData.current_value = params.current_value;
          if (params.cost_basis !== undefined) updateData.cost_basis = params.cost_basis;
          if (params.is_accessible !== undefined) updateData.is_accessible = params.is_accessible;
          if (params.details !== undefined) updateData.details = params.details;

          const { data: updated, error: updateErr } = await ctx.supabase
            .from('assets')
            .update(updateData)
            .eq('id', params.asset_id)
            .eq('user_id', ctx.userId)
            .select()
            .single();

          if (updateErr) {
            console.error('[tool:upsert_asset] update error:', updateErr);
            return { error: 'Could not update the asset. Please try again.' };
          }

          await updateAssetPortrait(ctx);
          return { action: 'updated', saved: updated };
        }

        // INSERT path
        if (!params.asset_type || !params.name) {
          return { error: 'asset_type and name are required for new assets.' };
        }

        // Resolve currency default from profile
        let currency = params.currency?.toUpperCase() || ctx.currency;
        if (!currency) {
          const { data: profile } = await ctx.supabase
            .from('user_profiles')
            .select('primary_currency')
            .eq('id', ctx.userId)
            .maybeSingle();
          currency = profile?.primary_currency || 'EUR';
        }

        const isAccessible =
          params.is_accessible !== undefined
            ? params.is_accessible
            : DEFAULT_ACCESSIBLE[params.asset_type];

        const insertData = {
          user_id: ctx.userId,
          asset_type: params.asset_type,
          name: params.name,
          provider: params.provider ?? null,
          currency,
          current_value: params.current_value ?? null,
          cost_basis: params.cost_basis ?? null,
          details: params.details ?? {},
          is_accessible: isAccessible,
          source: 'chat',
          last_updated: nowIso,
        };

        const { data: inserted, error: insertErr } = await ctx.supabase
          .from('assets')
          .insert(insertData)
          .select()
          .single();

        if (insertErr) {
          console.error('[tool:upsert_asset] insert error:', insertErr);
          return { error: 'Could not save the asset. Please try again.' };
        }

        await updateAssetPortrait(ctx);
        return { action: 'created', saved: inserted };
      } catch (err) {
        console.error('[tool:upsert_asset] unexpected error:', err);
        return { error: 'Something went wrong saving the asset. Please try again.' };
      }
    },
  };
}

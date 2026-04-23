'use client'

import { useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { Briefing } from './Briefing'
import { DetailHeader } from './DetailHeader'
import { DrillDownRow } from './DrillDownRow'
import { useTrackEvent } from '@/lib/events/use-track-event'
import type { BalanceSheetResponse } from '@/app/api/balance-sheet/route'

const ACCENT = '#06B6D4'

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatMonthShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' })
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<BalanceSheetResponse>
}

interface NetWorthDashboardProps {
  currency: string
}

export function NetWorthDashboard({ currency }: NetWorthDashboardProps) {
  const trackEvent = useTrackEvent()
  const { data, isLoading } = useSWR<BalanceSheetResponse>('/api/balance-sheet', fetcher)

  useEffect(() => {
    trackEvent('networth_dashboard_viewed', 'engagement')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const effectiveCurrency = data?.currency ?? currency

  return (
    <div className="px-3.5 pt-2 pb-24">
      <DetailHeader title="Net Worth" color={ACCENT} backHref="/office" />

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-32 rounded-[10px] bg-bg-deep animate-pulse" />
          <div className="h-20 rounded-[10px] bg-bg-deep animate-pulse" />
        </div>
      ) : !data || !data.has_data ? (
        <EmptyNetWorth />
      ) : (
        <>
          <Briefing accentColor={ACCENT}>{buildBriefing(data, effectiveCurrency)}</Briefing>

          <HeroTrend data={data} currency={effectiveCurrency} />

          <AssetsLiabilitiesRow data={data} currency={effectiveCurrency} />

          <Composition data={data} currency={effectiveCurrency} />

          <div className="flex flex-col gap-2 mb-4">
            <DrillDownRow
              title="Full balance sheet"
              subtitle="everything you own, everything you owe"
              href="/office/net-worth/balance-sheet"
              icon="≡"
              accentColor={ACCENT}
            />
            <DrillDownRow
              title="Assets"
              subtitle={data.total_assets > 0
                ? `${data.asset_groups.length} groups · ${formatCurrency(data.total_assets, effectiveCurrency)}`
                : 'savings, stocks, property'}
              href="/office/net-worth/assets"
              icon="↑"
              accentColor={ACCENT}
            />
            <DrillDownRow
              title="Liabilities"
              subtitle={data.total_liabilities > 0
                ? `${data.liability_groups.length} groups · ${formatCurrency(data.total_liabilities, effectiveCurrency)}`
                : 'debts and credit'}
              href="/office/net-worth/liabilities"
              icon="↓"
              accentColor={ACCENT}
            />
            <DrillDownRow
              title="Update balances"
              subtitle="upload · refresh via statement"
              href="/office/net-worth/upload"
              icon="⊕"
              accentColor={ACCENT}
            />
          </div>

          <div
            className="rounded-[10px] px-[14px] py-3"
            style={{
              background: `${ACCENT}08`,
              border: `0.5px solid ${ACCENT}30`,
            }}
          >
            <p
              className="text-[13px] leading-[1.5] italic"
              style={{
                fontFamily: 'var(--font-cormorant), Georgia, serif',
                color: 'var(--text-secondary)',
              }}
            >
              Got an account or a debt I don&apos;t know about? Just tell me in chat —{' '}
              <span className="text-text-primary not-italic">
                &ldquo;I have £5,000 in Trade Republic&rdquo;
              </span>{' '}
              and I&apos;ll add it.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function buildBriefing(data: BalanceSheetResponse, currency: string): string {
  const nw = formatCurrency(data.net_worth, currency)
  if (data.net_worth_change == null) {
    return `You're worth ${nw} today. Tell me more about what you own and owe and I'll track how it moves month to month.`
  }
  const deltaAbs = formatCurrency(Math.abs(data.net_worth_change), currency)
  const direction = data.net_worth_change >= 0 ? 'Up' : 'Down'
  return `You're worth ${nw} today. ${direction} ${deltaAbs} this month.`
}

// ─────────────────────────────────────────────────────────────────────────────

function HeroTrend({
  data,
  currency,
}: {
  data: BalanceSheetResponse
  currency: string
}) {
  const trend = data.trend.slice(-6)
  const hasTrend = trend.length > 1
  const max = hasTrend ? Math.max(...trend.map((t) => t.net_worth)) : data.net_worth
  const min = hasTrend ? Math.min(...trend.map((t) => t.net_worth)) * 0.92 : 0

  return (
    <div
      className="rounded-[12px] mb-4 px-[14px] py-4"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${ACCENT}30`,
      }}
    >
      <div className="flex items-baseline gap-2.5 mb-1">
        <div
          className="font-data tabular-nums font-semibold tracking-[-0.01em]"
          style={{ fontSize: 30, color: ACCENT, lineHeight: 1 }}
        >
          {formatCurrency(data.net_worth, currency)}
        </div>
        {data.net_worth_change != null && (
          <div
            className="flex items-center gap-0.5 text-[12px] font-medium"
            style={{
              color: data.net_worth_change >= 0 ? 'var(--positive)' : 'var(--negative)',
            }}
          >
            {data.net_worth_change >= 0 ? (
              <ArrowUp size={11} strokeWidth={2.5} />
            ) : (
              <ArrowDown size={11} strokeWidth={2.5} />
            )}
            {formatCurrency(Math.abs(data.net_worth_change), currency)}
          </div>
        )}
        <div className="text-[11px] text-text-tertiary ml-auto">
          {hasTrend ? `${trend.length}m` : 'now'}
        </div>
      </div>

      {hasTrend && (
        <>
          <div className="flex items-end gap-1.5 h-[88px] mt-3.5">
            {trend.map((t, i) => {
              const isNow = i === trend.length - 1
              const h = max > min ? ((t.net_worth - min) / (max - min)) * 100 : 50
              return (
                <div key={t.month} className="flex-1 flex flex-col items-center gap-[3px]">
                  <div
                    className="font-data tabular-nums text-[9px]"
                    style={{ color: isNow ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
                  >
                    {(t.net_worth / 1000).toFixed(0)}k
                  </div>
                  <div
                    className="w-full rounded-[3px]"
                    style={{
                      height: `${Math.max(h, 15)}%`,
                      background: isNow ? ACCENT : `${ACCENT}50`,
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex gap-1.5 mt-1.5">
            {trend.map((t, i) => {
              const isNow = i === trend.length - 1
              return (
                <div
                  key={t.month}
                  className="flex-1 text-center text-[9px]"
                  style={{
                    color: isNow ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: isNow ? 600 : 400,
                  }}
                >
                  {formatMonthShort(t.month)}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function AssetsLiabilitiesRow({
  data,
  currency,
}: {
  data: BalanceSheetResponse
  currency: string
}) {
  const assetCount = data.asset_groups.reduce((s, g) => s + g.items.length, 0)
  const liabCount = data.liability_groups.reduce((s, g) => s + g.items.length, 0)

  return (
    <div className="flex gap-2 mb-4">
      <div className="flex-1 rounded-[8px] px-3 py-3 bg-bg-card border border-[rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-1.5">
          <ArrowUp size={11} className="text-[color:var(--positive)]" strokeWidth={2.5} />
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
            Assets
          </span>
        </div>
        <div
          className="font-data text-[17px] tabular-nums font-medium mt-1"
          style={{ color: 'var(--positive)' }}
        >
          {formatCurrency(data.total_assets, currency)}
        </div>
        <div className="text-[10px] text-text-tertiary mt-0.5">
          {assetCount} item{assetCount === 1 ? '' : 's'}
        </div>
      </div>
      <div className="flex-1 rounded-[8px] px-3 py-3 bg-bg-card border border-[rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-1.5">
          <ArrowDown size={11} className="text-[color:var(--negative)]" strokeWidth={2.5} />
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
            Liabilities
          </span>
        </div>
        <div
          className="font-data text-[17px] tabular-nums font-medium mt-1"
          style={{ color: 'var(--negative)' }}
        >
          {formatCurrency(data.total_liabilities, currency)}
        </div>
        <div className="text-[10px] text-text-tertiary mt-0.5">
          {liabCount === 0 ? 'none recorded' : `${liabCount} item${liabCount === 1 ? '' : 's'}`}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Composition({
  data,
  currency,
}: {
  data: BalanceSheetResponse
  currency: string
}) {
  const assets = data.asset_groups.map((g) => ({
    key: `a-${g.type}`,
    label: g.label,
    amount: g.total,
    pct: data.total_assets > 0 ? (g.total / data.total_assets) * 100 : 0,
    color: g.color,
    isLiab: false,
  }))
  const liabs = data.liability_groups.map((g) => ({
    key: `l-${g.type}`,
    label: g.label,
    amount: g.total,
    pct: data.total_liabilities > 0 ? (g.total / data.total_liabilities) * 100 : 0,
    color: g.color,
    isLiab: true,
  }))
  const rows = [...assets, ...liabs]
  if (rows.length === 0) return null

  return (
    <div className="mb-4">
      <div className="text-[11px] font-semibold text-text-primary mb-[10px]">Composition</div>
      <div className="flex flex-col gap-[7px]">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: r.color }} />
            <div className="text-[12px] text-text-primary w-[108px] shrink-0 truncate">{r.label}</div>
            <div className="flex-1 h-1 bg-bg-inset rounded-[2px] overflow-hidden">
              <div
                className="h-full"
                style={{
                  width: `${Math.max(r.pct, 2)}%`,
                  background: r.color,
                  opacity: 0.85,
                }}
              />
            </div>
            <div
              className="font-data text-[11px] tabular-nums text-right w-[60px]"
              style={{ color: r.isLiab ? 'var(--negative)' : 'var(--text-primary)' }}
            >
              {formatCurrency(r.amount, currency)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function EmptyNetWorth() {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-10">
      <p className="text-sm text-text-secondary max-w-[280px]">
        Track your assets and debts to see your net worth take shape.
      </p>
      <Link
        href="/office/net-worth/upload"
        className="text-[13px] font-medium"
        style={{ color: ACCENT }}
      >
        Set up &rarr;
      </Link>
    </div>
  )
}

export default NetWorthDashboard

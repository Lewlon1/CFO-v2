'use client'

import { useState, useTransition } from 'react'
import {
  submitIncome,
  submitRent,
  advanceToConfirm,
  type InstantPayback,
} from '@/app/onboarding-v2/processing/processing-actions'
import { GoalPaceInline } from './goal-pace-inline'

type Props = {
  initialIncome: number | null
  initialRent: number | null
  currencySymbol: string
  importComplete: boolean
  onAdvance: (redirectTo: string) => void
}

type FieldStatus = 'pristine' | 'saving' | 'saved' | 'error'

/**
 * Two-field form rendered on the processing screen alongside the parse
 * progress strip. Income is submitted on blur so the goal-pace one-liner
 * can render immediately — the spec's "step must give, not just take"
 * payback. Rent persists on blur too. Continue is enabled when both
 * fields are saved AND the import pipeline has finished.
 *
 * Phase 3 adds an optional "other fixed bills" repeater here; for Phase 2
 * the form is income + rent only.
 */
export function ProcessingForm({
  initialIncome,
  initialRent,
  currencySymbol,
  importComplete,
  onAdvance,
}: Props) {
  const [income, setIncome] = useState<string>(
    initialIncome != null ? String(initialIncome) : '',
  )
  const [rent, setRent] = useState<string>(
    initialRent != null ? String(initialRent) : '',
  )
  const [incomeStatus, setIncomeStatus] = useState<FieldStatus>(
    initialIncome != null ? 'saved' : 'pristine',
  )
  const [rentStatus, setRentStatus] = useState<FieldStatus>(
    initialRent != null ? 'saved' : 'pristine',
  )
  const [payback, setPayback] = useState<InstantPayback | null>(null)
  const [pendingAdvance, startAdvance] = useTransition()

  const incomeReady = incomeStatus === 'saved'
  const rentReady = rentStatus === 'saved'
  const canAdvance = incomeReady && rentReady && importComplete

  async function handleIncomeBlur() {
    const value = Number.parseFloat(income)
    if (!Number.isFinite(value) || value <= 0) return
    if (initialIncome === value) return
    setIncomeStatus('saving')
    try {
      const result = await submitIncome(value)
      setPayback(result)
      setIncomeStatus('saved')
    } catch (err) {
      console.error('[processing-form] submitIncome failed', err)
      setIncomeStatus('error')
    }
  }

  async function handleRentBlur() {
    const value = Number.parseFloat(rent)
    if (!Number.isFinite(value) || value < 0) return
    if (initialRent === value) return
    setRentStatus('saving')
    try {
      await submitRent(value)
      setRentStatus('saved')
    } catch (err) {
      console.error('[processing-form] submitRent failed', err)
      setRentStatus('error')
    }
  }

  function handleContinue() {
    if (!canAdvance || pendingAdvance) return
    startAdvance(async () => {
      try {
        const { redirectTo } = await advanceToConfirm()
        onAdvance(redirectTo)
      } catch (err) {
        console.error('[processing-form] advance failed', err)
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-medium text-text-primary leading-tight">
          While that runs — two quick numbers.
        </h2>
        <p className="text-sm text-text-secondary leading-snug">
          These let me pace anything against what you actually have to work with.
        </p>
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <label
            htmlFor="processing-income"
            className="block text-sm font-medium text-text-primary"
          >
            What&apos;s your monthly take-home pay?
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              {currencySymbol}
            </span>
            <input
              id="processing-income"
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={income}
              onChange={(e) => {
                setIncome(e.target.value)
                if (incomeStatus !== 'pristine') setIncomeStatus('pristine')
              }}
              onBlur={handleIncomeBlur}
              placeholder="3,100"
              className="w-full pl-8 pr-3 py-3 min-h-[44px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-text-primary/40"
            />
          </div>
          {incomeStatus === 'saving' && (
            <p className="text-xs text-text-muted">Saving…</p>
          )}
          {incomeStatus === 'error' && (
            <p className="text-xs text-red-500">
              Couldn&apos;t save that — try again.
            </p>
          )}
          {incomeStatus === 'saved' && <GoalPaceInline payback={payback} />}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="processing-rent"
            className="block text-sm font-medium text-text-primary"
          >
            And the biggest fixed line — what&apos;s housing?
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              {currencySymbol}
            </span>
            <input
              id="processing-rent"
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={rent}
              onChange={(e) => {
                setRent(e.target.value)
                if (rentStatus !== 'pristine') setRentStatus('pristine')
              }}
              onBlur={handleRentBlur}
              placeholder="950"
              className="w-full pl-8 pr-3 py-3 min-h-[44px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-text-primary/40"
            />
          </div>
          {rentStatus === 'saving' && (
            <p className="text-xs text-text-muted">Saving…</p>
          )}
          {rentStatus === 'error' && (
            <p className="text-xs text-red-500">
              Couldn&apos;t save that — try again.
            </p>
          )}
          {rentStatus === 'saved' && (
            <p className="text-xs text-text-muted">Saved — fixed cost on file.</p>
          )}
        </div>
      </div>

      <div className="pt-2">
        <button
          type="button"
          disabled={!canAdvance || pendingAdvance}
          onClick={handleContinue}
          className="w-full min-h-[44px] rounded-lg bg-text-primary text-bg-base text-sm font-medium px-4 py-3 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {!importComplete && incomeReady && rentReady
            ? 'Just a moment — finishing up…'
            : 'Looks good — show me the picture'}
        </button>
        {(!incomeReady || !rentReady) && (
          <p className="text-xs text-text-muted mt-2 text-center">
            Fill in both numbers above to continue.
          </p>
        )}
      </div>
    </div>
  )
}

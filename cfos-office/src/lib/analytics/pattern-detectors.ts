// cfos-office/src/lib/analytics/pattern-detectors.ts

import type { PatternDetector } from './insight-types';
import { analyseGap, gapResultToPatternResult } from './gap-analyser';

// --- Shared helpers (used by multiple detectors) ---

export function normaliseMerchant(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatCurrency(amount: number, currency: string): string {
  const symbol = currency === 'EUR' ? '€'
    : currency === 'GBP' ? '£'
    : currency === 'USD' ? '$'
    : currency + ' ';
  return `${symbol}${Math.round(amount).toLocaleString()}`;
}

export function isExpense(amount: number): boolean { return amount < 0; }

export function absExpense(amount: number): number { return amount < 0 ? -amount : 0; }

// --- Detectors ---

// C1: Shopping footprint across many food stores, many small trips.
export const merchantFragmentation: PatternDetector = {
  id: 'merchant_fragmentation',
  layer: 'hidden_pattern',
  requires: ['transactions'],
  detect: (ctx) => {
    const FOOD_CATEGORIES = ['groceries', 'dining_out', 'convenience'];
    const txns = ctx.transactions.filter(
      (t) =>
        isExpense(Number(t.amount)) &&
        t.category_id !== null &&
        FOOD_CATEGORIES.includes(t.category_id)
    );
    if (txns.length < 10) return null;

    const merchantSet = new Set<string>();
    let total = 0;
    let under5Count = 0;
    for (const t of txns) {
      const abs = absExpense(Number(t.amount));
      total += abs;
      if (abs < 5) under5Count += 1;
      const key = normaliseMerchant(t.description ?? '');
      if (key) merchantSet.add(key);
    }
    const storeCount = merchantSet.size;
    const avgTrip = total / txns.length;
    const under5Pct = under5Count / txns.length;

    let score = 0;
    if (storeCount >= 8) score += 30;
    if (avgTrip < 10) score += 25;
    if (under5Pct > 0.35) score += 20;
    if (score === 0) return null;

    return {
      id: 'merchant_fragmentation',
      score,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: {
        storeCount,
        avgTrip: Math.round(avgTrip),
        under5Count,
        under5Pct: Math.round(under5Pct * 100),
      },
      narrative_prompt: `Name that the user shops at ${storeCount} different food stores with an average trip of ${formatCurrency(avgTrip, ctx.currency)}. Note that ${under5Count} trips were under ${formatCurrency(5, ctx.currency)}. Frame as a pattern observation, not a judgement.`,
    };
  },
};

// C2: Many small transactions forming a modest share of total spend.
export const transactionSizeDistribution: PatternDetector = {
  id: 'transaction_size_distribution',
  layer: 'hidden_pattern',
  requires: ['transactions'],
  detect: (ctx) => {
    const txns = ctx.transactions.filter((t) => isExpense(Number(t.amount)));
    if (txns.length < 30) return null;

    let totalSpend = 0;
    let under10Count = 0;
    let under10Total = 0;
    for (const t of txns) {
      const abs = absExpense(Number(t.amount));
      totalSpend += abs;
      if (abs < 10) {
        under10Count += 1;
        under10Total += abs;
      }
    }
    const countPct = under10Count / txns.length;
    const amountPct = totalSpend > 0 ? under10Total / totalSpend : 0;

    let score = 0;
    if (countPct > 0.40 && amountPct < 0.15) score += 40;
    else if (countPct > 0.30) score += 20;
    if (score === 0) return null;

    return {
      id: 'transaction_size_distribution',
      score,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: {
        countUnder10: under10Count,
        pctCountUnder10: Math.round(countPct * 100),
        pctSpendUnder10: Math.round(amountPct * 100),
      },
      narrative_prompt: `${Math.round(countPct * 100)}% of transactions are under ${formatCurrency(10, ctx.currency)} (${under10Count} decisions for ${Math.round(amountPct * 100)}% of total spend). Many small decisions, modest share of the money — useful to name.`,
    };
  },
};

// C3: One or two categories dominate discretionary spend.
export const categoryConcentration: PatternDetector = {
  id: 'category_concentration',
  layer: 'headline',
  requires: ['transactions'],
  detect: (ctx) => {
    const EXCLUDED = new Set(['rent', 'mortgage']);
    const txns = ctx.transactions.filter(
      (t) =>
        isExpense(Number(t.amount)) &&
        t.category_id !== null &&
        !EXCLUDED.has(t.category_id)
    );
    if (txns.length < 15) return null;

    const byCategory = new Map<string, number>();
    let total = 0;
    for (const t of txns) {
      const cat = t.category_id as string;
      const abs = absExpense(Number(t.amount));
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + abs);
      total += abs;
    }
    if (total <= 0) return null;

    const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const top1 = sorted[0];
    const top2 = sorted[1] ?? null;
    const top1Pct = top1[1] / total;
    const top2Pct = top2 ? (top1[1] + top2[1]) / total : top1Pct;

    let score = 0;
    if (top1Pct > 0.35) score += 50;
    if (top2Pct > 0.55) score = Math.max(score, 40);
    if (score === 0) return null;

    return {
      id: 'category_concentration',
      score,
      layer: 'headline',
      requires: ['transactions'],
      data: {
        topCategory: top1[0],
        topAmount: Math.round(top1[1]),
        topPct: Math.round(top1Pct * 100),
        top2Category: top2?.[0] ?? null,
        top2Pct: Math.round(top2Pct * 100),
      },
      narrative_prompt: `${top1[0]} is ${Math.round(top1Pct * 100)}% of spending (${formatCurrency(top1[1], ctx.currency)}). Use this as the headline perspective shift.`,
    };
  },
};

// C4: Spending cadence — active-day density and quiet stretches.
export const spendingVelocity: PatternDetector = {
  id: 'spending_velocity',
  layer: 'hidden_pattern',
  requires: ['transactions'],
  detect: (ctx) => {
    const txns = ctx.transactions.filter((t) => isExpense(Number(t.amount)));
    if (txns.length < 20) return null;

    // Bucket by ISO date (YYYY-MM-DD) using UTC-slicing.
    const dayCounts = new Map<string, number>();
    let minTime = Infinity;
    let maxTime = -Infinity;
    for (const t of txns) {
      const d = new Date(t.date);
      const time = d.getTime();
      if (!Number.isFinite(time)) continue;
      if (time < minTime) minTime = time;
      if (time > maxTime) maxTime = time;
      const key = d.toISOString().slice(0, 10);
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }
    if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) return null;

    const DAY_MS = 24 * 60 * 60 * 1000;
    const totalDays = Math.floor((maxTime - minTime) / DAY_MS) + 1;
    if (totalDays < 14) return null;

    // Walk every day in the range to compute zero-spend days and the longest run.
    let zeroSpendDays = 0;
    let longestStreak = 0;
    let currentStreak = 0;
    const start = new Date(minTime);
    start.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < totalDays; i++) {
      const day = new Date(start.getTime() + i * DAY_MS);
      const key = day.toISOString().slice(0, 10);
      if ((dayCounts.get(key) ?? 0) === 0) {
        zeroSpendDays += 1;
        currentStreak += 1;
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      } else {
        currentStreak = 0;
      }
    }
    const activeDays = totalDays - zeroSpendDays;
    const avgTxnsPerActiveDay =
      activeDays > 0 ? Math.round((txns.length / activeDays) * 10) / 10 : 0;

    let score = 0;
    if (zeroSpendDays / totalDays < 0.10) score += 35;
    if (longestStreak > 14) score += 25;
    if (score === 0) return null;

    return {
      id: 'spending_velocity',
      score,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: {
        totalDays,
        zeroSpendDays,
        longestStreak,
        activeDays,
        avgTxnsPerActiveDay,
      },
      narrative_prompt: `Spending on ${activeDays} of ${totalDays} days — ${longestStreak > 0 ? 'longest quiet stretch: ' + longestStreak + ' days' : 'essentially every day'}. Name this as a rhythm observation.`,
    };
  },
};

// C5: Total recurring load and overlapping-subscription groups.
export const recurringExpenseTotal: PatternDetector = {
  id: 'recurring_expense_total',
  layer: 'hidden_pattern',
  requires: ['transactions'],
  detect: (ctx) => {
    const recurring = ctx.recurring;
    if (recurring.length < 3) return null;

    // Normalise each entry to a monthly-equivalent cost.
    let total = 0;
    for (const r of recurring) {
      const amount = Math.abs(Number(r.amount));
      const freq = (r.frequency ?? '').toLowerCase();
      let monthlyEquivalent: number;
      if (freq === 'monthly') monthlyEquivalent = amount * 1;
      else if (freq === 'bi-monthly') monthlyEquivalent = amount / 2;
      else if (freq === 'annual') monthlyEquivalent = amount / 12;
      else monthlyEquivalent = amount; // irregular / unknown → treat as monthly
      total += monthlyEquivalent;
    }

    // Flag overlap groups where ≥2 entries share a category we care about.
    const OVERLAP_GROUPS: Array<{ name: string; categoryId: string }> = [
      { name: 'streaming', categoryId: 'entertainment' },
      { name: 'transport', categoryId: 'transport' },
      { name: 'gym', categoryId: 'health_fitness' },
    ];
    const overlaps: string[] = [];
    for (const group of OVERLAP_GROUPS) {
      const count = recurring.filter((r) => r.category_id === group.categoryId).length;
      if (count >= 2) overlaps.push(group.name);
    }

    // Compare against the most recent monthly snapshot if available.
    const avgMonthly = ctx.snapshots[0]?.total_spending ?? null;
    const recurringPct =
      avgMonthly && avgMonthly > 0 ? total / avgMonthly : null;

    let score = 0;
    if (overlaps.length > 0) score += 45;
    if (recurringPct !== null && recurringPct > 0.40) score += 30;
    if (score === 0) return null;

    const recurringPctRounded =
      recurringPct !== null ? Math.round(recurringPct * 100) : null;

    return {
      id: 'recurring_expense_total',
      score,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: {
        totalMonthly: Math.round(total),
        count: recurring.length,
        overlaps,
        recurringPct: recurringPctRounded,
      },
      narrative_prompt: `${recurring.length} recurring bills totalling ${formatCurrency(total, ctx.currency)} per month${overlaps.length ? '. Overlap detected in: ' + overlaps.join(', ') : ''}. ${recurringPctRounded !== null ? recurringPctRounded.toString() + '% of average monthly spend. ' : ''}Name the overlap specifically if present.`,
    };
  },
};

// C6: Day-of-week skew — one day carries an outsized share of spend.
export const dayOfWeekSkew: PatternDetector = {
  id: 'day_of_week_skew',
  layer: 'hidden_pattern',
  requires: ['transactions'],
  detect: (ctx) => {
    const txns = ctx.transactions.filter((t) => isExpense(Number(t.amount)));
    if (txns.length < 20) return null;

    const byDay = [0, 0, 0, 0, 0, 0, 0];
    for (const t of txns) {
      const d = new Date(t.date);
      if (!Number.isFinite(d.getTime())) continue;
      byDay[d.getDay()] += absExpense(Number(t.amount));
    }

    let maxIdx = 0;
    for (let i = 1; i < 7; i++) if (byDay[i] > byDay[maxIdx]) maxIdx = i;
    const max = byDay[maxIdx];
    const otherSum = byDay.reduce((acc, v, i) => (i === maxIdx ? acc : acc + v), 0);
    const mean = otherSum / 6;
    const ratio = max / (mean || 1);

    let score = 0;
    if (ratio > 2) score += 35;
    if (maxIdx === 0 || maxIdx === 5 || maxIdx === 6) score += 10;
    if (score === 0) return null;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const ratioRounded = Math.round(ratio * 100) / 100;

    return {
      id: 'day_of_week_skew',
      score,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: {
        outlierDay: maxIdx,
        outlierName: dayNames[maxIdx],
        outlierAmount: Math.round(max),
        otherAvg: Math.round(mean),
        ratio: ratioRounded,
      },
      narrative_prompt: `${dayNames[maxIdx]}s carry ${ratioRounded}x the average of other days (${formatCurrency(max, ctx.currency)} vs ${formatCurrency(mean, ctx.currency)}). Name the day pattern.`,
    };
  },
};

// C7: Convenience vs planned trips at the same chain.
export const convenienceVsPlanned: PatternDetector = {
  id: 'convenience_vs_planned',
  layer: 'hidden_pattern',
  requires: ['transactions'],
  detect: (ctx) => {
    const FOOD_CATEGORIES = new Set(['groceries', 'convenience', 'dining_out']);
    const CONVENIENCE_RE = /\b(express|metro|city|local|mini|stop|corner|24h)\b/i;

    type Bucket = { trips: number; total: number };
    const convenience = new Map<string, Bucket>();
    const planned = new Map<string, Bucket>();

    for (const t of ctx.transactions) {
      if (!isExpense(Number(t.amount))) continue;
      if (!t.category_id || !FOOD_CATEGORIES.has(t.category_id)) continue;
      const desc = t.description ?? '';
      const normalised = normaliseMerchant(desc);
      if (!normalised) continue;
      const prefix = normalised.split(' ')[0];
      if (!prefix) continue;
      const abs = absExpense(Number(t.amount));
      const target = CONVENIENCE_RE.test(desc) ? convenience : planned;
      const existing = target.get(prefix) ?? { trips: 0, total: 0 };
      existing.trips += 1;
      existing.total += abs;
      target.set(prefix, existing);
    }

    // Find chains present in both buckets with the highest convenience:planned ratio.
    let bestChain: string | null = null;
    let bestRatio = 0;
    let bestConvenience: Bucket | null = null;
    let bestPlanned: Bucket | null = null;
    for (const [chain, convBucket] of convenience) {
      const planBucket = planned.get(chain);
      if (!planBucket || planBucket.trips === 0) continue;
      const ratio = convBucket.trips / planBucket.trips;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestChain = chain;
        bestConvenience = convBucket;
        bestPlanned = planBucket;
      }
    }
    if (!bestChain || !bestConvenience || !bestPlanned) return null;

    let score = 0;
    if (bestRatio > 2) score += 35;
    if (score === 0) return null;

    const ratioRounded = Math.round(bestRatio * 100) / 100;

    return {
      id: 'convenience_vs_planned',
      score,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: {
        chain: bestChain,
        convenienceTrips: bestConvenience.trips,
        plannedTrips: bestPlanned.trips,
        ratio: ratioRounded,
        convenienceTotal: Math.round(bestConvenience.total),
        plannedTotal: Math.round(bestPlanned.total),
      },
      narrative_prompt: `For ${bestChain}: ${bestConvenience.trips} convenience-store trips vs ${bestPlanned.trips} main-shop trips (${ratioRounded}x). ${formatCurrency(bestConvenience.total, ctx.currency)} at convenience vs ${formatCurrency(bestPlanned.total, ctx.currency)} at main. Name this behaviour pattern without moralising.`,
    };
  },
};

// C8: Income presence/cadence — NEVER exposes the amount (anti-hallucination).
export const incomeDetected: PatternDetector = {
  id: 'income_detected',
  layer: 'headline',
  requires: ['transactions', 'income_signal'],
  detect: (ctx) => {
    const deposits = ctx.transactions
      .filter((t) => Number(t.amount) > 0)
      .slice()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (deposits.length < 2) return null;

    // Group deposits by the first 3 significant words of the normalised description.
    type Group = {
      label: string;
      entries: typeof deposits;
    };
    const groups = new Map<string, Group>();
    for (const d of deposits) {
      const normalised = normaliseMerchant(d.description ?? '');
      if (!normalised) continue;
      const words = normalised.split(' ').filter((w) => w.length > 0);
      const key = words.slice(0, 3).join(' ');
      if (!key) continue;
      const existing = groups.get(key);
      if (existing) existing.entries.push(d);
      else groups.set(key, { label: key, entries: [d] });
    }
    if (groups.size === 0) return null;

    // For each group, count pairs of consecutive entries whose gap falls in [25, 35] days.
    const DAY_MS = 24 * 60 * 60 * 1000;
    let bestGroup: Group | null = null;
    let bestCadenceCount = 0;
    for (const group of groups.values()) {
      if (group.entries.length < 2) continue;
      let cadenceCount = 0;
      for (let i = 1; i < group.entries.length; i++) {
        const prev = new Date(group.entries[i - 1].date).getTime();
        const curr = new Date(group.entries[i].date).getTime();
        if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
        const gap = Math.round((curr - prev) / DAY_MS);
        if (gap >= 25 && gap <= 35) cadenceCount += 1;
      }
      if (cadenceCount > bestCadenceCount) {
        bestCadenceCount = cadenceCount;
        bestGroup = group;
      }
    }
    if (!bestGroup) return null;

    let score = 0;
    if (bestCadenceCount >= 1) score += 25;
    if (score === 0) return null;

    const cadence: 'monthly' | 'irregular' =
      bestCadenceCount >= 1 ? 'monthly' : 'irregular';
    const latest = bestGroup.entries[bestGroup.entries.length - 1];

    // CRITICAL: no amount is emitted. Claude must not be able to divide by income.
    return {
      id: 'income_detected',
      score,
      layer: 'headline',
      requires: ['transactions', 'income_signal'],
      data: {
        cadence,
        depositCount: bestGroup.entries.length,
        latestDate: latest.date,
        groupLabel: bestGroup.label,
      },
      narrative_prompt: `If this wins the headline, acknowledge you can see regular deposits without stating the amount. Never divide anything by this. Do not say 'your income' — say 'I can see regular deposits'. Cadence: ${cadence}. Latest: ${latest.date}.`,
    };
  },
};

// D1: Value Map gap — stated value category vs actual spending.
export const valueMapGap: PatternDetector = {
  id: 'value_map_gap',
  layer: 'gap',
  requires: ['transactions', 'value_map'],
  detect: async ({ supabase, userId, valueMap }) => {
    if (!valueMap) return null;
    const gapResult = await analyseGap(supabase, userId, 3);
    return gapResultToPatternResult(gapResult);
  },
};

// D3: Geographic spending modes — different daily rates by location.
export const geographicSpendingModes: PatternDetector = {
  id: 'geographic_spending_modes',
  layer: 'headline',
  requires: ['transactions', 'location_data'],
  detect: (ctx) => {
    interface Group {
      location: string;
      total: number;
      count: number;
      minDate: number;
      maxDate: number;
    }
    const groups = new Map<string, Group>();
    for (const t of ctx.transactions) {
      if (!isExpense(Number(t.amount))) continue;
      const city = t.location_city;
      const country = t.location_country;
      const location = city ?? country ?? null;
      if (!location) continue;
      const time = new Date(t.date).getTime();
      if (!Number.isFinite(time)) continue;
      const abs = absExpense(Number(t.amount));
      const existing = groups.get(location);
      if (existing) {
        existing.total += abs;
        existing.count += 1;
        if (time < existing.minDate) existing.minDate = time;
        if (time > existing.maxDate) existing.maxDate = time;
      } else {
        groups.set(location, {
          location,
          total: abs,
          count: 1,
          minDate: time,
          maxDate: time,
        });
      }
    }

    // Retain groups with ≥ 3 transactions and compute daily rate.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const eligible = [...groups.values()]
      .filter((g) => g.count >= 3)
      .map((g) => {
        const daysSpanned = Math.max(
          1,
          Math.floor((g.maxDate - g.minDate) / DAY_MS) + 1,
        );
        const dailyRate = g.total / daysSpanned;
        return { ...g, daysSpanned, dailyRate };
      });
    if (eligible.length < 2) return null;

    const sorted = [...eligible].sort((a, b) => b.dailyRate - a.dailyRate);
    const top1 = sorted[0];
    const top2 = sorted[1];
    const higher = Math.max(top1.dailyRate, top2.dailyRate);
    if (higher <= 0) return null;
    const delta = Math.abs(top1.dailyRate - top2.dailyRate) / higher;

    let score = 0;
    if (delta > 0.30) score += 40;
    if (score === 0) return null;

    const topGroups = sorted.slice(0, 3).map((g) => ({
      location: g.location,
      total: Math.round(g.total),
      count: g.count,
      dailyRate: Math.round(g.dailyRate),
      daysSpanned: g.daysSpanned,
    }));

    return {
      id: 'geographic_spending_modes',
      score,
      layer: 'headline',
      requires: ['transactions', 'location_data'],
      data: { groups: topGroups },
      narrative_prompt:
        `Two distinct spending modes by location. ${topGroups[0].location}: ` +
        `${formatCurrency(topGroups[0].dailyRate, ctx.currency)}/day over ${topGroups[0].daysSpanned} days. ` +
        `${topGroups[1].location}: ${formatCurrency(topGroups[1].dailyRate, ctx.currency)}/day over ` +
        `${topGroups[1].daysSpanned} days. Name this as a perspective shift — same person, different modes.`,
    };
  },
};

// D2: Month-over-month headline trend from monthly_snapshots.
export const monthOverMonthTrend: PatternDetector = {
  id: 'month_over_month_trend',
  layer: 'numbers',
  requires: ['transactions', 'multi_month'],
  detect: (ctx) => {
    const snapshots = ctx.snapshots;
    if (snapshots.length < 2) return null;
    const current = snapshots[0];
    const prior = snapshots[1];
    const currentTotal = Number(current.total_spending ?? 0);
    const priorTotal = Number(prior.total_spending ?? 0);
    if (priorTotal <= 0) return null;

    const delta = currentTotal - priorTotal;
    const pctChange = delta / priorTotal;

    // Biggest single-category shift (absolute delta), only for categories present in both.
    const currentCat =
      typeof current.spending_by_category === 'object' &&
      current.spending_by_category !== null
        ? (current.spending_by_category as Record<string, number>)
        : {};
    const priorCat =
      typeof prior.spending_by_category === 'object' &&
      prior.spending_by_category !== null
        ? (prior.spending_by_category as Record<string, number>)
        : {};

    let biggestShiftCategory: string | null = null;
    let biggestShiftDelta: number | null = null;
    let biggestShiftAbs = 0;
    for (const key of Object.keys(currentCat)) {
      if (!(key in priorCat)) continue;
      const cur = Number(currentCat[key] ?? 0);
      const pri = Number(priorCat[key] ?? 0);
      const d = cur - pri;
      if (Math.abs(d) > biggestShiftAbs) {
        biggestShiftAbs = Math.abs(d);
        biggestShiftCategory = key;
        biggestShiftDelta = d;
      }
    }

    let score = 0;
    if (Math.abs(pctChange) >= 0.15) score += 35;
    if (
      biggestShiftCategory !== null &&
      Math.abs(delta) > 0 &&
      biggestShiftAbs / Math.abs(delta) > 0.25
    ) {
      score += 25;
    }
    if (score === 0) return null;
    score = Math.min(score, 60);

    const pctChangeRounded = Math.round(pctChange * 100);

    return {
      id: 'month_over_month_trend',
      score,
      layer: 'numbers',
      requires: ['transactions', 'multi_month'],
      data: {
        currentMonth: current.month,
        priorMonth: prior.month,
        currentTotal: Math.round(currentTotal),
        priorTotal: Math.round(priorTotal),
        pctChange: pctChangeRounded,
        biggestShiftCategory,
        biggestShiftDelta:
          biggestShiftDelta !== null ? Math.round(biggestShiftDelta) : null,
      },
      narrative_prompt:
        `Spending ${pctChange > 0 ? 'up' : 'down'} ${Math.abs(pctChangeRounded)}% month-over-month: ` +
        `${formatCurrency(currentTotal, ctx.currency)} vs ${formatCurrency(priorTotal, ctx.currency)}` +
        `${biggestShiftCategory ? '. Biggest single-category shift: ' + biggestShiftCategory : ''}. ` +
        `Use as the numbers-layer hit.`,
    };
  },
};

// D4: Balance trajectory — sawtooth pay-cycle vs declining balance shape.
export const balanceTrajectory: PatternDetector = {
  id: 'balance_trajectory',
  layer: 'headline',
  requires: ['transactions', 'balance_data'],
  detect: (ctx) => {
    const withBalance = ctx.transactions
      .filter((t) => t.balance !== null && t.balance !== undefined)
      .slice()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (withBalance.length < 30) return null;

    interface MonthStats {
      month: string;
      minBalance: number;
      maxBalance: number;
      startBalance: number;
      endBalance: number;
    }
    const byMonth = new Map<string, MonthStats>();
    for (const t of withBalance) {
      const d = new Date(t.date);
      if (!Number.isFinite(d.getTime())) continue;
      const monthKey = d.toISOString().slice(0, 7);
      const bal = Number(t.balance);
      const existing = byMonth.get(monthKey);
      if (existing) {
        if (bal < existing.minBalance) existing.minBalance = bal;
        if (bal > existing.maxBalance) existing.maxBalance = bal;
        // Transactions are date-ascending, so later wins for endBalance.
        existing.endBalance = bal;
      } else {
        byMonth.set(monthKey, {
          month: monthKey,
          minBalance: bal,
          maxBalance: bal,
          startBalance: bal,
          endBalance: bal,
        });
      }
    }
    const monthStats = [...byMonth.values()].sort((a, b) =>
      a.month.localeCompare(b.month),
    );
    if (monthStats.length === 0) return null;

    // Detect sawtooth: every month has minBalance < 0.3 * maxBalance.
    const isSawtooth = monthStats.every(
      (m) => m.maxBalance > 0 && m.minBalance < 0.3 * m.maxBalance,
    );
    // Detect decline: last month end < first month end by > 20% (only when positive baseline).
    const firstEnd = monthStats[0].endBalance;
    const lastEnd = monthStats[monthStats.length - 1].endBalance;
    const isDecline =
      firstEnd > 0 && lastEnd < firstEnd * 0.8;

    let shape: 'sawtooth' | 'decline' | null = null;
    let score = 0;
    if (isSawtooth) {
      shape = 'sawtooth';
      score = 40;
    } else if (isDecline) {
      shape = 'decline';
      score = 35;
    }
    if (!shape || score === 0) return null;

    const peakBalance = monthStats.reduce(
      (max, m) => (m.maxBalance > max ? m.maxBalance : max),
      monthStats[0].maxBalance,
    );
    const troughBalance = monthStats.reduce(
      (min, m) => (m.minBalance < min ? m.minBalance : min),
      monthStats[0].minBalance,
    );

    const roundedMonths = monthStats.map((m) => ({
      month: m.month,
      minBalance: Math.round(m.minBalance),
      maxBalance: Math.round(m.maxBalance),
      startBalance: Math.round(m.startBalance),
      endBalance: Math.round(m.endBalance),
    }));

    const narrative_prompt =
      `Balance shape: ${shape}. ` +
      (shape === 'sawtooth'
        ? `Peaks of ${formatCurrency(peakBalance, ctx.currency)} cycling down to ` +
          `${formatCurrency(troughBalance, ctx.currency)}. This reads as a consistent pay-cycle rhythm.`
        : `Declining trajectory: ${formatCurrency(firstEnd, ctx.currency)} → ` +
          `${formatCurrency(lastEnd, ctx.currency)}. Name the direction without projecting forward.`) +
      ` Use as headline.`;

    return {
      id: 'balance_trajectory',
      score,
      layer: 'headline',
      requires: ['transactions', 'balance_data'],
      data: {
        shape,
        months: roundedMonths,
        peakBalance: Math.round(peakBalance),
        troughBalance: Math.round(troughBalance),
      },
      narrative_prompt,
    };
  },
};

// --- Library registration ---

// Detectors registered in Phase C/D.
export const PATTERN_LIBRARY: PatternDetector[] = [
  merchantFragmentation,
  transactionSizeDistribution,
  categoryConcentration,
  spendingVelocity,
  recurringExpenseTotal,
  dayOfWeekSkew,
  convenienceVsPlanned,
  incomeDetected,
  valueMapGap,
  monthOverMonthTrend,
  geographicSpendingModes,
  balanceTrajectory,
];

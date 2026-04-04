'use client';

import { useRouter } from 'next/navigation';
import { CompletenessIndicator } from './CompletenessIndicator';
import { ProfileCard } from './ProfileCard';
import { TraitDisplay } from './TraitDisplay';
import { PROFILE_QUESTIONS } from '@/lib/profiling/question-registry';

// ── Types ──────────────────────────────────────────────────────────────────────

type Profile = Record<string, unknown>;

type ProfilingEntry = {
  field: string;
  source: string;
};

type Trait = {
  id: string;
  trait_key: string;
  trait_value: string;
  trait_type: string;
  confidence: number;
  evidence: string | null;
  source: string;
};

// ── Field labels ──────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  primary_currency: 'Currency',
  country: 'Country',
  net_monthly_income: 'Monthly take-home pay',
  housing_type: 'Housing situation',
  age_range: 'Age range',
  employment_status: 'Employment',
  monthly_rent: 'Monthly rent/mortgage',
  relationship_status: 'Relationship status',
  risk_tolerance: 'Risk tolerance',
  dependents: 'Dependents',
  advice_style: 'Communication preference',
  spending_triggers: 'Spending triggers',
  nationality: 'Nationality',
  partner_monthly_contribution: 'Partner contribution',
  has_bonus_months: 'Bonus months',
  gross_salary: 'Gross salary',
  pay_frequency: 'Pay frequency',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSource(field: string, profilingEntries: ProfilingEntry[]): string | null {
  const entry = profilingEntries.find((e) => e.field === field);
  return entry?.source ?? null;
}

function getQuestion(field: string) {
  return PROFILE_QUESTIONS.find((q) => q.field === field);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProfilePageClient({
  profile,
  profilingEntries,
  traits,
}: {
  profile: Profile;
  profilingEntries: ProfilingEntry[];
  traits: Trait[];
}) {
  const router = useRouter();
  const completeness = (profile.profile_completeness as number) || 0;
  const currency = (profile.primary_currency as string) || 'EUR';

  const refresh = () => router.refresh();

  const makeField = (field: string) => ({
    field,
    label: FIELD_LABELS[field] || field,
    value: profile[field] as string | number | boolean | null | undefined,
    source: getSource(field, profilingEntries) as 'structured_input' | 'conversation' | 'inferred' | 'value_map' | 'post_conversation' | null,
    question: getQuestion(field),
  });

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-2xl mx-auto pb-20">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-foreground">What your CFO knows</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything the system knows about you. Edit anything, dismiss what's wrong.
        </p>
      </div>

      {/* Completeness */}
      <CompletenessIndicator percentage={completeness} />

      {/* Essentials */}
      <ProfileCard
        title="Essentials"
        fields={[
          makeField('country'),
          makeField('primary_currency'),
          makeField('net_monthly_income'),
          makeField('housing_type'),
        ]}
        userCurrency={currency}
        onUpdate={refresh}
      />

      {/* Personal */}
      <ProfileCard
        title="Personal"
        fields={[
          makeField('age_range'),
          makeField('employment_status'),
          makeField('relationship_status'),
          makeField('dependents'),
        ]}
        userCurrency={currency}
        onUpdate={refresh}
      />

      {/* Financial Details */}
      <ProfileCard
        title="Financial Details"
        fields={[
          makeField('monthly_rent'),
          makeField('gross_salary'),
          makeField('pay_frequency'),
          makeField('has_bonus_months'),
          makeField('risk_tolerance'),
        ]}
        userCurrency={currency}
        onUpdate={refresh}
      />

      {/* Preferences */}
      <ProfileCard
        title="Preferences"
        fields={[
          makeField('advice_style'),
          makeField('spending_triggers'),
          makeField('nationality'),
          makeField('partner_monthly_contribution'),
        ]}
        userCurrency={currency}
        onUpdate={refresh}
      />

      {/* Financial Portrait */}
      <TraitDisplay traits={traits} />
    </div>
  );
}

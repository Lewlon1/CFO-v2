'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Upload, Settings } from 'lucide-react';
import { CompletenessIndicator } from './CompletenessIndicator';
import { ProfileCard } from './ProfileCard';
import { TraitDisplay } from './TraitDisplay';
import { DataFreshness } from './DataFreshness';
import { ImportHistory } from './ImportHistory';
import { DataManagement } from './DataManagement';
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

type ImportBatch = {
  import_batch_id: string;
  source: string;
  transaction_count: number;
  earliest_date: string;
  latest_date: string;
  imported_at: string;
};

type DataSummary = {
  monthsCovered: number;
  latestMonth: string | null;
  totalTransactions: number;
  traitCount: number;
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

// ── Collapsible Section ──────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-card border border-border rounded-xl">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full p-4 text-left min-h-[44px]"
      >
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProfilePageClient({
  profile,
  profilingEntries,
  traits,
  dataSummary,
  imports,
}: {
  profile: Profile;
  profilingEntries: ProfilingEntry[];
  traits: Trait[];
  dataSummary: DataSummary;
  imports: ImportBatch[];
}) {
  const router = useRouter();
  const completeness = (profile.profile_completeness as number) || 0;
  const currency = (profile.primary_currency as string) || 'EUR';

  const refresh = () => router.refresh();

  // Sync the sidebar whenever the profile page mounts — the layout is a Server
  // Component that only re-fetches when router.refresh() is called, so it can
  // show a stale profile_completeness if the profile was updated via chat.
  useEffect(() => {
    router.refresh();
  }, [router]);

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

      {/* Data Freshness */}
      <DataFreshness
        monthsCovered={dataSummary.monthsCovered}
        latestMonth={dataSummary.latestMonth}
        totalTransactions={dataSummary.totalTransactions}
      />

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

      {/* Import History */}
      <CollapsibleSection
        title="Import History"
        icon={<Upload className="w-4 h-4 text-primary" />}
        defaultOpen={imports.length > 0}
      >
        <ImportHistory imports={imports} />
      </CollapsibleSection>

      {/* Data Management */}
      <CollapsibleSection
        title="Data Management"
        icon={<Settings className="w-4 h-4 text-primary" />}
      >
        <DataManagement dataSummary={dataSummary} />
      </CollapsibleSection>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type SelectOption = { value: string; label: string };

export type StructuredInputConfig = {
  type: 'structured_input';
  field: string;
  input_type: 'single_select' | 'multi_select' | 'currency_amount' | 'number' | 'text' | 'slider';
  label: string;
  rationale?: string;
  options?: SelectOption[];
  min?: number;
  max?: number;
  currency?: boolean;
  placeholder?: string;
  low_label?: string;
  high_label?: string;
};

type StructuredInputProps = {
  config: StructuredInputConfig;
  onSubmit: (field: string, value: string | number, displayText: string) => void;
  userCurrency?: string;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function StructuredInput({ config, onSubmit, userCurrency }: StructuredInputProps) {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedDisplay, setSubmittedDisplay] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (value: string | number, displayText: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(config.field, value, displayText);
      setSubmitted(true);
      setSubmittedDisplay(displayText);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="mt-3 px-3 animate-in fade-in duration-300">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{submittedDisplay}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 px-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {config.rationale && (
        <p className="text-xs text-muted-foreground mb-2 italic">{config.rationale}</p>
      )}
      {error && (
        <p className="text-xs text-red-400 mb-2">{error}</p>
      )}

      {config.input_type === 'single_select' && (
        <SingleSelect
          options={config.options ?? []}
          onSelect={handleSubmit}
          disabled={submitting}
        />
      )}
      {config.input_type === 'multi_select' && (
        <MultiSelect
          options={config.options ?? []}
          onSubmit={handleSubmit}
          disabled={submitting}
        />
      )}
      {config.input_type === 'currency_amount' && (
        <CurrencyAmount
          currency={userCurrency || 'EUR'}
          placeholder={config.placeholder}
          min={config.min}
          max={config.max}
          onSubmit={handleSubmit}
          disabled={submitting}
        />
      )}
      {config.input_type === 'number' && (
        <NumberInput
          placeholder={config.placeholder}
          min={config.min}
          max={config.max}
          onSubmit={handleSubmit}
          disabled={submitting}
        />
      )}
      {config.input_type === 'text' && (
        <TextInput
          placeholder={config.placeholder}
          onSubmit={handleSubmit}
          disabled={submitting}
        />
      )}
      {config.input_type === 'slider' && (
        <SliderInput
          min={config.min ?? 1}
          max={config.max ?? 10}
          lowLabel={config.low_label ?? 'Low'}
          highLabel={config.high_label ?? 'High'}
          onSubmit={handleSubmit}
          disabled={submitting}
        />
      )}
    </div>
  );
}

// ── Variants ──────────────────────────────────────────────────────────────────

function SingleSelect({
  options,
  onSelect,
  disabled,
}: {
  options: SelectOption[];
  onSelect: (value: string, display: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value, opt.label)}
          disabled={disabled}
          className="px-4 py-2 rounded-full border border-border text-sm text-foreground/90 hover:bg-muted active:bg-muted/80 transition-colors min-h-[44px] disabled:opacity-50"
        >
          {disabled ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            opt.label
          )}
        </button>
      ))}
    </div>
  );
}

function MultiSelect({
  options,
  onSubmit,
  disabled,
}: {
  options: SelectOption[];
  onSubmit: (value: string, display: string) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const handleDone = () => {
    const values = Array.from(selected);
    const labels = options
      .filter((o) => selected.has(o.value))
      .map((o) => o.label);
    onSubmit(JSON.stringify(values), labels.join(', '));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => toggle(opt.value)}
            disabled={disabled}
            className={`px-4 py-2 rounded-full border text-sm transition-colors min-h-[44px] disabled:opacity-50 ${
              selected.has(opt.value)
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-foreground/90 hover:bg-muted'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {selected.size > 0 && (
        <button
          onClick={handleDone}
          disabled={disabled}
          className="mt-3 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium min-h-[44px] disabled:opacity-50"
        >
          {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Done'}
        </button>
      )}
    </div>
  );
}

function CurrencyAmount({
  currency,
  placeholder,
  min,
  max,
  onSubmit,
  disabled,
}: {
  currency: string;
  placeholder?: string;
  min?: number;
  max?: number;
  onSubmit: (value: number, display: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState('');

  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'CHF' ? 'Fr.' : '€';

  const handleSave = () => {
    const num = parseFloat(value.replace(/,/g, ''));
    if (isNaN(num)) return;
    if (min !== undefined && num < min) return;
    if (max !== undefined && num > max) return;
    onSubmit(num, `${symbol}${num.toLocaleString()}`);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 bg-input border border-border rounded-xl px-3 py-2 flex-1">
        <span className="text-muted-foreground text-sm">{symbol}</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder || '0'}
          disabled={disabled}
          className="bg-transparent text-sm text-foreground outline-none w-full min-h-[28px]"
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        />
      </div>
      <button
        onClick={handleSave}
        disabled={disabled || !value}
        className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium min-h-[44px] disabled:opacity-50"
      >
        {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
      </button>
    </div>
  );
}

function NumberInput({
  placeholder,
  min,
  max,
  onSubmit,
  disabled,
}: {
  placeholder?: string;
  min?: number;
  max?: number;
  onSubmit: (value: number, display: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState('');

  const handleSave = () => {
    const num = parseInt(value, 10);
    if (isNaN(num)) return;
    if (min !== undefined && num < min) return;
    if (max !== undefined && num > max) return;
    onSubmit(num, String(num));
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder || '0'}
        min={min}
        max={max}
        disabled={disabled}
        className="bg-input border border-border rounded-xl px-3 py-2 text-sm text-foreground outline-none w-24 min-h-[44px]"
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
      />
      <button
        onClick={handleSave}
        disabled={disabled || !value}
        className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium min-h-[44px] disabled:opacity-50"
      >
        {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
      </button>
    </div>
  );
}

function TextInput({
  placeholder,
  onSubmit,
  disabled,
}: {
  placeholder?: string;
  onSubmit: (value: string, display: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState('');

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed, trimmed);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder || ''}
        disabled={disabled}
        className="bg-input border border-border rounded-xl px-3 py-2 text-sm text-foreground outline-none flex-1 min-h-[44px]"
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
      />
      <button
        onClick={handleSave}
        disabled={disabled || !value.trim()}
        className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium min-h-[44px] disabled:opacity-50"
      >
        {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
      </button>
    </div>
  );
}

function SliderInput({
  min,
  max,
  lowLabel,
  highLabel,
  onSubmit,
  disabled,
}: {
  min: number;
  max: number;
  lowLabel: string;
  highLabel: string;
  onSubmit: (value: number, display: string) => void;
  disabled: boolean;
}) {
  const mid = Math.round((min + max) / 2);
  const [value, setValue] = useState(mid);

  return (
    <div>
      <div className="text-center text-lg font-semibold text-foreground mb-2">
        {value}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        disabled={disabled}
        className="w-full accent-primary min-h-[44px]"
      />
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
      <button
        onClick={() => onSubmit(value, `${value}/${max}`)}
        disabled={disabled}
        className="mt-3 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium min-h-[44px] disabled:opacity-50"
      >
        {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
      </button>
    </div>
  );
}

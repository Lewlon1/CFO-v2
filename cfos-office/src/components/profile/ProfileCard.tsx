'use client';

import { useState } from 'react';
import { Pencil, Check, MessageCircle, Lightbulb, Sparkles } from 'lucide-react';
import { StructuredInput } from '@/components/chat/StructuredInput';
import type { StructuredInputConfig } from '@/components/chat/StructuredInput';
import type { ProfileQuestion } from '@/lib/profiling/question-registry';

// ── Types ──────────────────────────────────────────────────────────────────────

type FieldSource = 'structured_input' | 'conversation' | 'inferred' | 'value_map' | 'post_conversation' | null;

type ProfileFieldData = {
  field: string;
  label: string;
  value: string | number | boolean | null | undefined;
  source: FieldSource;
  question?: ProfileQuestion;
};

type ProfileCardProps = {
  title: string;
  fields: ProfileFieldData[];
  userCurrency?: string;
  onUpdate: () => void;
};

// ── Source indicator ───────────────────────────────────────────────────────────

function SourceIndicator({ source }: { source: FieldSource }) {
  if (!source) return null;

  switch (source) {
    case 'structured_input':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
          <Check className="w-3 h-3" /> You told us
        </span>
      );
    case 'conversation':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-blue-400">
          <MessageCircle className="w-3 h-3" /> From chat
        </span>
      );
    case 'inferred':
    case 'post_conversation':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-yellow-400">
          <Lightbulb className="w-3 h-3" /> Inferred
        </span>
      );
    case 'value_map':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-primary">
          <Sparkles className="w-3 h-3" /> From Value Map
        </span>
      );
    default:
      return null;
  }
}

// ── Format display value ──────────────────────────────────────────────────────

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') {
    // Try to parse JSON arrays for multi-select values
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.join(', ');
    } catch {
      // Not JSON, use as-is
    }
    return value;
  }
  return String(value);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProfileCard({ title, fields, userCurrency, onUpdate }: ProfileCardProps) {
  const [editing, setEditing] = useState<string | null>(null);

  const handleSubmit = async (field: string, value: string | number, _displayText: string) => {
    await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value }),
    });
    setEditing(null);
    onUpdate();
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      <div className="space-y-3">
        {fields.map((f) => {
          const isEmpty = f.value === null || f.value === undefined || f.value === '';
          const isEditing = editing === f.field;

          return (
            <div key={f.field}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p
                    className={`text-sm ${
                      isEmpty ? 'text-muted-foreground/50 italic' : 'text-foreground'
                    }`}
                  >
                    {formatValue(f.value)}
                  </p>
                  {!isEmpty && <SourceIndicator source={f.source} />}
                </div>
                {f.question && !isEditing && (
                  <button
                    onClick={() => setEditing(f.field)}
                    className="p-2 rounded-lg hover:bg-muted transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>

              {isEditing && f.question && (
                <div className="mt-2">
                  <StructuredInput
                    config={{
                      type: 'structured_input',
                      field: f.field,
                      input_type: f.question.input_config.input_type,
                      label: f.question.label,
                      rationale: f.question.rationale,
                      options: f.question.input_config.options,
                      min: f.question.input_config.min,
                      max: f.question.input_config.max,
                      placeholder: f.question.input_config.placeholder,
                      low_label: f.question.input_config.low_label,
                      high_label: f.question.input_config.high_label,
                      currency: f.question.input_config.currency,
                    } satisfies StructuredInputConfig}
                    onSubmit={handleSubmit}
                    userCurrency={userCurrency}
                  />
                  <button
                    onClick={() => setEditing(null)}
                    className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

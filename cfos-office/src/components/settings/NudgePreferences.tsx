'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { NUDGE_RULES, NUDGE_ICONS, NUDGE_LABELS, type NudgeType } from '@/lib/nudges/rules';

const NUDGE_TYPES = Object.keys(NUDGE_RULES) as NudgeType[];

export function NudgePreferences({
  initialPreferences,
}: {
  initialPreferences: Record<string, { enabled: boolean }>;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const supabase = createClient();

  const handleToggle = useCallback(
    async (type: NudgeType) => {
      const rule = NUDGE_RULES[type];
      const current = preferences[type]?.enabled ?? rule.enabled_by_default;
      const updated = { ...preferences, [type]: { enabled: !current } };

      // Optimistic update
      setPreferences(updated);

      const { error } = await supabase
        .from('user_profiles')
        .update({ nudge_preferences: updated })
        .eq('id', (await supabase.auth.getUser()).data.user!.id);

      if (error) {
        // Revert on failure
        setPreferences(preferences);
      }
    },
    [preferences, supabase]
  );

  return (
    <div className="space-y-1">
      {NUDGE_TYPES.map(type => {
        const rule = NUDGE_RULES[type];
        const isEnabled = preferences[type]?.enabled ?? rule.enabled_by_default;
        const icon = NUDGE_ICONS[type];
        const label = NUDGE_LABELS[type];

        return (
          <div
            key={type}
            className="flex items-center justify-between px-3 py-3 rounded-lg hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-base leading-none">{icon}</span>
              <span className="text-sm text-foreground">{label}</span>
            </div>

            <button
              onClick={() => handleToggle(type)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors min-h-[44px] min-w-[44px] ${
                isEnabled ? 'bg-primary' : 'bg-muted'
              }`}
              role="switch"
              aria-checked={isEnabled}
              aria-label={`${label} ${isEnabled ? 'enabled' : 'disabled'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}

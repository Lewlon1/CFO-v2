'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const SCENARIO_CARDS = [
  {
    type: 'salary_increase',
    icon: '💰',
    title: 'Salary increase',
    description: 'What if I got a raise?',
    message: 'I want to model a salary increase',
  },
  {
    type: 'property_purchase',
    icon: '🏠',
    title: 'Property purchase',
    description: 'What would a mortgage look like?',
    message: 'I want to model buying a property',
  },
  {
    type: 'children',
    icon: '👶',
    title: 'Children',
    description: 'What if I had a child?',
    message: 'I want to model having a child',
  },
  {
    type: 'career_change',
    icon: '🔄',
    title: 'Career change',
    description: 'What if I switched jobs?',
    message: 'I want to model a career change',
  },
  {
    type: 'investment_growth',
    icon: '📈',
    title: 'Investment growth',
    description: 'How would my investments grow?',
    message: 'I want to model investment growth',
  },
  {
    type: 'expense_reduction',
    icon: '✂️',
    title: 'Cut spending',
    description: 'What if I reduced a category?',
    message: 'I want to model cutting my spending on a category',
  },
];

interface RecentScenario {
  id: string;
  title: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

export function ScenariosClient({
  recentScenarios,
}: {
  recentScenarios: RecentScenario[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleCardClick(card: (typeof SCENARIO_CARDS)[number]) {
    if (loading) return;
    setLoading(card.type);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Mark existing active conversations as completed
      await supabase
        .from('conversations')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('status', 'active');

      // Create new scenario conversation
      const { data: conv, error } = await supabase
        .from('conversations')
        .insert({
          user_id: user.id,
          title: card.title,
          type: 'scenario',
          metadata: { scenario_type: card.type },
        })
        .select('id')
        .single();

      if (error || !conv) {
        console.error('Failed to create scenario conversation:', error);
        setLoading(null);
        return;
      }

      // Navigate to the chat with the first message
      router.push(`/chat/${conv.id}?starter=${encodeURIComponent(card.message)}`);
    } catch (err) {
      console.error('Error starting scenario:', err);
      setLoading(null);
    }
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-foreground mb-1">What if...</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Explore how life changes would affect your finances
      </p>

      {/* Scenario cards */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {SCENARIO_CARDS.map((card) => (
          <button
            key={card.type}
            onClick={() => handleCardClick(card)}
            disabled={loading !== null}
            className="flex flex-col items-start gap-2 p-4 bg-card border border-border rounded-xl hover:bg-accent hover:border-primary/30 transition-colors text-left min-h-[100px] disabled:opacity-50"
          >
            <span className="text-2xl">{card.icon}</span>
            <div>
              <p className="text-sm font-medium text-foreground">{card.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.description}</p>
            </div>
            {loading === card.type && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Recent scenarios */}
      {recentScenarios.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Recent scenarios</h2>
          <div className="space-y-1">
            {recentScenarios.map((s) => (
              <button
                key={s.id}
                onClick={() => router.push(`/chat/${s.id}`)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left hover:bg-accent transition-colors"
              >
                <span className="text-sm text-foreground truncate">{s.title}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                  {formatDate(s.updated_at)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

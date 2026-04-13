'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, UIMessage } from 'ai';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { WelcomeState } from './WelcomeState';
import { ChatLoadingScreen } from './ChatLoadingScreen';
import { MobileConversationDrawer } from './MobileConversationDrawer';
import { PresetDropdown } from './PresetDropdown';
import type { PromptButton } from '@/lib/chat/prompt-buttons';
import { useTrackEvent } from '@/lib/events/use-track-event';

interface ChatInterfaceProps {
  initialConversationId: string | null;
  initialMessages?: UIMessage[];
  conversationType?: string;
  conversationMetadata?: Record<string, string>;
  userCurrency?: string;
  starterMessage?: string;
  conversations?: Array<{ id: string; title: string | null; updated_at: string }>;
  hasTransactions?: boolean;
}

export function ChatInterface({
  initialConversationId,
  initialMessages,
  conversationType,
  conversationMetadata,
  userCurrency,
  starterMessage,
  conversations,
  hasTransactions = false,
}: ChatInterfaceProps) {
  const router = useRouter();
  const trackEvent = useTrackEvent();
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId
  );
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const [input, setInput] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [subject, setSubject] = useState<string>(
    () => {
      if (initialConversationId && conversations) {
        const match = conversations.find((c) => c.id === initialConversationId);
        return match?.title || 'New conversation';
      }
      return 'New conversation';
    }
  );
  const autoTriggeredRef = useRef(false);
  const conversationTypeRef = useRef(conversationType);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        conversationId: conversationIdRef.current,
        // Pass conversation type only when creating a new conversation
        ...(!conversationIdRef.current && conversationTypeRef.current ? { conversationType: conversationTypeRef.current } : {}),
        ...(!conversationIdRef.current && conversationMetadata ? { conversationMetadata } : {}),
      }),
    }),
    messages: initialMessages,
    onError: (error) => {
      const msg = error?.message || '';
      if (msg.includes('429') || msg.toLowerCase().includes('busy')) {
        setChatError('Too many requests. Please wait a moment and try again.');
      } else if (msg.includes('504') || msg.toLowerCase().includes('timeout')) {
        setChatError('Response timed out. Please try again.');
      } else {
        setChatError('Something went wrong. Please try again.');
      }
    },
    onFinish: ({ messages: finishedMessages }) => {
      // Extract conversationId from the assistant message metadata
      const lastAssistant = [...finishedMessages]
        .reverse()
        .find((m) => m.role === 'assistant');
      if (
        lastAssistant?.metadata &&
        typeof lastAssistant.metadata === 'object' &&
        'conversationId' in lastAssistant.metadata &&
        lastAssistant.metadata.conversationId
      ) {
        const newId = lastAssistant.metadata.conversationId as string;
        if (!conversationIdRef.current || conversationIdRef.current !== newId) {
          setConversationId(newId);
          // Navigate to the conversation route so Next.js router state is correct
          // (history.replaceState breaks "New conversation" by desync-ing the router)
          router.replace(`/chat/${newId}`);
        }
      }

      // Refresh the layout if the profile was updated via tool so the sidebar
      // percentage reflects the new value without requiring navigation
      const profileUpdated = finishedMessages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.parts) &&
          m.parts.some(
            (p: { type: string; state?: string }) =>
              p.type === 'tool-update_user_profile' && p.state === 'output-available'
          )
      );
      if (profileUpdated) {
        router.refresh();
      }
    },
  });

  // Auto-trigger for CFO-led conversations: Claude speaks first
  useEffect(() => {
    const isAutoTriggerType = conversationType === 'post_upload'
      || conversationType === 'value_map_complete'
      || conversationType === 'monthly_review'
      || conversationType === 'bill_optimisation'
      || conversationType === 'nudge_initiated'
      || conversationType === 'onboarding'
      || conversationType === 'onboarding_no_vm'
      || conversationType === 'value_checkin_done';
    if (
      isAutoTriggerType &&
      messages.length === 0 &&
      status === 'ready' &&
      !autoTriggeredRef.current
    ) {
      autoTriggeredRef.current = true;
      let trigger: string;
      if (conversationType === 'onboarding') {
        trigger = '[System: New user just completed the Value Map and signed up. Deliver your first-meeting welcome per your conversation instructions. Reference their archetype in one line, then prompt them to upload a recent bank statement so you can show them what is actually going on with their money. Include the markdown link [Upload your transactions](/transactions). Maximum 4 sentences. Do not mention sample data or the Value Map mechanics.]';
      } else if (conversationType === 'onboarding_no_vm') {
        trigger = '[System: New user who signed up directly. Welcome them briefly, then suggest the Value Map as a quick way to get started — "a 2-minute exercise that helps me understand how you think about money." You MUST include this exact markdown link in your response: [Try the Value Map](/demo). If they want to skip it, that is fine.]';
      } else if (conversationType === 'value_map_complete') {
        trigger = '[System: Value Map just completed. Deliver your Gap analysis — compare their stated values with their actual spending now.]';
      } else if (conversationType === 'monthly_review') {
        trigger = '[System: Monthly review started. Begin with Phase 1 — the headline number.]';
      } else if (conversationType === 'bill_optimisation') {
        trigger = '[System: User wants to discuss a specific bill. Review the bill details in your context and open with a focused observation — cost vs market, contract status, or an obvious saving opportunity.]';
      } else if (conversationType === 'nudge_initiated') {
        const nudgeType = conversationMetadata?.nudge_type ?? 'general';
        trigger = `[System: User arrived via ${nudgeType} nudge. Open the conversation proactively.]`;
      } else if (conversationType === 'value_checkin_done') {
        const count = conversationMetadata?.checkin_count ?? 'several';
        trigger = `[System: User just finished a value check-in — they classified ${count} transactions. Acknowledge what you learned in 2 sentences. Reference one specific insight if visible in your review context (e.g. "so your Friday night takeaways are Leaks, not Foundation"). Do NOT list everything they classified. Keep it warm and brief, then offer to discuss anything on their mind.]`;
      } else {
        trigger = '[System: Post-upload analysis triggered. Deliver your first insight.]';
      }
      sendMessage({ text: trigger });
    }
  }, [conversationType, conversationMetadata, messages.length, status, sendMessage]);

  // Auto-send starter message (e.g. from /scenarios page redirect)
  const starterSentRef = useRef(false);
  useEffect(() => {
    if (
      starterMessage &&
      messages.length === 0 &&
      status === 'ready' &&
      !starterSentRef.current &&
      !autoTriggeredRef.current
    ) {
      starterSentRef.current = true;
      sendMessage({ text: starterMessage });
    }
  }, [starterMessage, messages.length, status, sendMessage]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setChatError(null);
    setInput('');
    // Update subject from first manual message (matches server-side title logic)
    if (messages.length === 0 && subject === 'New conversation') {
      setSubject(text.slice(0, 80));
    }
    trackEvent('message_sent');
    sendMessage({ text });
  }, [input, messages.length, subject, sendMessage, trackEvent]);

  const handleStarterSelect = useCallback(
    (text: string, type?: string) => {
      if (type) {
        conversationTypeRef.current = type;
      }
      sendMessage({ text });
    },
    [sendMessage]
  );

  const handleOptionSelect = useCallback(
    (text: string) => {
      // Profiling agreement buttons need a system trigger to force the tool call.
      // Plain text replies cause the model to generate preamble without calling the tool.
      const isProfilingAgreement = /let.s do a few now|sure.*profile|do.*now/i.test(text);
      if (isProfilingAgreement) {
        sendMessage({
          text: '[System: User agreed to profiling. IMMEDIATELY call request_structured_input with field="net_monthly_income", input_type="currency_amount", label="What\'s your monthly take-home pay?", rationale="Helps me tell you whether your spending patterns are sustainable". Do not output any text before the tool call — just call the tool now.]',
        });
      } else {
        sendMessage({ text });
      }
    },
    [sendMessage]
  );

  // Handle structured input submissions from inline form components
  const handleStructuredSubmit = useCallback(
    async (field: string, value: string | number, displayText: string) => {
      // Save to database first
      await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
      });
      // Then send the response as a message so Claude can continue
      sendMessage({ text: displayText });
    },
    [sendMessage]
  );

  const handlePresetSelect = useCallback(
    (prompt: PromptButton) => {
      setSubject(prompt.label);
      setPresetOpen(false);
      trackEvent('prompt_button_clicked', 'engagement', {
        prompt_id: prompt.id,
        prompt_label: prompt.label,
        source: 'header_dropdown',
      });
      if (prompt.conversationType) {
        conversationTypeRef.current = prompt.conversationType;
      }
      sendMessage({ text: prompt.message });
    },
    [sendMessage, trackEvent]
  );

  const isLoading = status === 'submitted' || status === 'streaming';
  const isAutoTriggered = conversationType === 'post_upload' || conversationType === 'value_map_complete' || conversationType === 'bill_optimisation' || conversationType === 'monthly_review' || conversationType === 'onboarding' || conversationType === 'onboarding_no_vm';

  // For auto-triggered conversations, skip the welcome state
  const showWelcome = messages.length === 0 && !isLoading && !isAutoTriggered;

  const mobileChatHeader = (
    <div className="md:hidden relative border-b border-border bg-card">
      <div className="flex items-center justify-between px-2 py-1">
        <MobileConversationDrawer conversations={conversations ?? []} />
        <button
          onClick={() => setPresetOpen((v) => !v)}
          className="flex items-center gap-1 min-w-0 flex-1 justify-center px-2 min-h-[44px]"
          aria-label="Open preset questions"
        >
          <span className="text-sm font-medium text-foreground truncate max-w-[200px]">
            {subject}
          </span>
          <svg
            className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${presetOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <Link
          href="/chat"
          className="p-2 text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="New conversation"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </Link>
      </div>
      {presetOpen && (
        <PresetDropdown
          hasTransactions={hasTransactions}
          onSelect={handlePresetSelect}
          onClose={() => setPresetOpen(false)}
        />
      )}
    </div>
  );

  const errorBanner = chatError ? (
    <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-amber-800 text-sm flex items-center justify-between">
      <span>{chatError}</span>
      <button
        onClick={() => setChatError(null)}
        className="ml-3 text-amber-600 hover:text-amber-800 font-medium shrink-0"
      >
        Dismiss
      </button>
    </div>
  ) : null;

  if (showWelcome) {
    return (
      <div className="flex flex-col h-full min-h-0 min-w-0">
        {mobileChatHeader}
        <WelcomeState
          onSelect={handleStarterSelect}
          hasTransactions={hasTransactions}
        />
        {errorBanner}
        <ChatInput
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          disabled={isLoading}
        />
      </div>
    );
  }

  // For auto-triggered conversations, show a branded loading screen until the
  // first assistant token arrives, then fall through to the normal chat view.
  const hasAnyAssistantToken = messages.some((m) => m.role === 'assistant');
  if (isAutoTriggered && !hasAnyAssistantToken) {
    return (
      <div className="flex flex-col h-full min-h-0 min-w-0">
        {mobileChatHeader}
        <ChatLoadingScreen />
      </div>
    );
  }

  const showValueMapCta = conversationType === 'onboarding_no_vm' && messages.length > 0 && !isLoading;
  const showUploadCta = conversationType === 'value_map_complete' && messages.length > 0 && !isLoading;

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {mobileChatHeader}
      <MessageList
        messages={messages}
        status={status}
        onOptionSelect={handleOptionSelect}
        onStructuredSubmit={handleStructuredSubmit}
        userCurrency={userCurrency}
      />
      {showValueMapCta && (
        <div className="px-4 py-3 border-t border-border bg-primary/5">
          <Link
            href="/demo"
            className="flex items-center justify-between w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <span>Try the Value Map — 2 minutes</span>
            <span className="opacity-80">→</span>
          </Link>
          <p className="text-xs text-muted-foreground mt-2 text-center">Helps your CFO give you personalised advice</p>
        </div>
      )}
      {showUploadCta && (
        <div className="px-4 py-3 border-t border-border bg-primary/5">
          <Link
            href="/transactions"
            className="flex items-center justify-between w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <span>Upload your transactions</span>
            <span className="opacity-80">→</span>
          </Link>
          <p className="text-xs text-muted-foreground mt-2 text-center">So your CFO can complete the gap analysis</p>
        </div>
      )}
      {errorBanner}
      <ChatInput
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        disabled={isLoading}
      />
    </div>
  );
}

'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, UIMessage } from 'ai';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { WelcomeState } from './WelcomeState';
import { useTrackEvent } from '@/lib/events/use-track-event';

interface ChatInterfaceProps {
  initialConversationId: string | null;
  initialMessages?: UIMessage[];
  conversationType?: string;
  conversationMetadata?: Record<string, string>;
  userCurrency?: string;
  starterMessage?: string;
}

export function ChatInterface({
  initialConversationId,
  initialMessages,
  conversationType,
  conversationMetadata,
  userCurrency,
  starterMessage,
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
      || conversationType === 'onboarding_no_vm';
    if (
      isAutoTriggerType &&
      messages.length === 0 &&
      status === 'ready' &&
      !autoTriggeredRef.current
    ) {
      autoTriggeredRef.current = true;
      let trigger: string;
      if (conversationType === 'onboarding') {
        trigger = '[System: New user who just completed the Value Map and signed up. Welcome them warmly, reference their archetype and what you noticed about their spending values. Keep it to 2-3 sentences, then ask what they want to tackle first.]';
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
    trackEvent('message_sent');
    sendMessage({ text });
  }, [input, sendMessage, trackEvent]);

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
      sendMessage({ text });
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

  const isLoading = status === 'submitted' || status === 'streaming';
  const isAutoTriggered = conversationType === 'post_upload' || conversationType === 'value_map_complete' || conversationType === 'bill_optimisation' || conversationType === 'monthly_review' || conversationType === 'onboarding' || conversationType === 'onboarding_no_vm';

  // For auto-triggered conversations, skip the welcome state
  const showWelcome = messages.length === 0 && !isLoading && !isAutoTriggered;

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
      <div className="flex flex-col h-full min-w-0">
        <WelcomeState onSelect={handleStarterSelect} />
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

  const showValueMapCta = conversationType === 'onboarding_no_vm' && messages.length > 0 && !isLoading;
  const showUploadCta = conversationType === 'value_map_complete' && messages.length > 0 && !isLoading;

  return (
    <div className="flex flex-col h-full min-w-0">
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

'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, UIMessage } from 'ai';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { WelcomeState } from './WelcomeState';

interface ChatInterfaceProps {
  initialConversationId: string | null;
  initialMessages?: UIMessage[];
  conversationType?: string;
  userCurrency?: string;
  starterMessage?: string;
}

export function ChatInterface({
  initialConversationId,
  initialMessages,
  conversationType,
  userCurrency,
  starterMessage,
}: ChatInterfaceProps) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId
  );
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const [input, setInput] = useState('');
  const autoTriggeredRef = useRef(false);
  const conversationTypeRef = useRef(conversationType);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        conversationId: conversationIdRef.current,
        // Pass conversation type only when creating a new conversation
        ...(!conversationIdRef.current && conversationTypeRef.current ? { conversationType: conversationTypeRef.current } : {}),
      }),
    }),
    messages: initialMessages,
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
      || conversationType === 'bill_optimisation';
    if (
      isAutoTriggerType &&
      messages.length === 0 &&
      status === 'ready' &&
      !autoTriggeredRef.current
    ) {
      autoTriggeredRef.current = true;
      let trigger: string;
      if (conversationType === 'value_map_complete') {
        trigger = '[System: Value Map just completed. Deliver your Gap analysis — compare their stated values with their actual spending now.]';
      } else if (conversationType === 'monthly_review') {
        trigger = '[System: Monthly review started. Begin with Phase 1 — the headline number.]';
      } else if (conversationType === 'bill_optimisation') {
        trigger = '[System: User wants to discuss a specific bill. Review the bill details in your context and open with a focused observation — cost vs market, contract status, or an obvious saving opportunity.]';
      } else {
        trigger = '[System: Post-upload analysis triggered. Deliver your first insight.]';
      }
      sendMessage({ text: trigger });
    }
  }, [conversationType, messages.length, status, sendMessage]);

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
    setInput('');
    sendMessage({ text });
  }, [input, sendMessage]);

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
  const isAutoTriggered = conversationType === 'post_upload' || conversationType === 'value_map_complete' || conversationType === 'bill_optimisation' || conversationType === 'monthly_review';

  // For auto-triggered conversations, skip the welcome state
  const showWelcome = messages.length === 0 && !isLoading && !isAutoTriggered;

  if (showWelcome) {
    return (
      <div className="flex flex-col h-full min-w-0">
        <WelcomeState onSelect={handleStarterSelect} />
        <ChatInput
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          disabled={isLoading}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      <MessageList
        messages={messages}
        status={status}
        onOptionSelect={handleOptionSelect}
        onStructuredSubmit={handleStructuredSubmit}
        userCurrency={userCurrency}
      />
      <ChatInput
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        disabled={isLoading}
      />
    </div>
  );
}

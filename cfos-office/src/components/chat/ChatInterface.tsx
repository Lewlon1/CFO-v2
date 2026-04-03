'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, UIMessage } from 'ai';
import { useRef, useState, useCallback } from 'react';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { WelcomeState } from './WelcomeState';

interface ChatInterfaceProps {
  initialConversationId: string | null;
  initialMessages?: UIMessage[];
}

export function ChatInterface({
  initialConversationId,
  initialMessages,
}: ChatInterfaceProps) {
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId
  );
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const [input, setInput] = useState('');

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({ conversationId: conversationIdRef.current }),
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
          // Update URL without navigation
          window.history.replaceState(null, '', `/chat/${newId}`);
        }
      }
    },
  });

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendMessage({ text });
  }, [input, sendMessage]);

  const handleStarterSelect = useCallback(
    (text: string) => {
      sendMessage({ text });
    },
    [sendMessage]
  );

  const isLoading = status === 'submitted' || status === 'streaming';

  if (messages.length === 0 && !isLoading) {
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
      <MessageList messages={messages} status={status} />
      <ChatInput
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        disabled={isLoading}
      />
    </div>
  );
}

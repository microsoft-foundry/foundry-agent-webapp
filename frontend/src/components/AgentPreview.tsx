import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ChatInterface } from './ChatInterface';
import { SettingsPanel } from './core/SettingsPanel';
import { useAppState } from '../hooks/useAppState';
import { useAuth } from '../hooks/useAuth';
import { ChatService } from '../services/chatService';
import { useAppContext } from '../hooks/useAppContext';
import styles from './AgentPreview.module.css';

interface AgentOption {
  id: string;
  name: string;
}

interface AgentPreviewProps {
  agentId: string;
  agentName: string;
  agentDescription?: string;
  agentLogo?: string;
  starterPrompts?: string[];
  agents?: AgentOption[];
  selectedAgentId?: string;
  onAgentChange?: (agentId: string) => void;
}

export const AgentPreview: React.FC<AgentPreviewProps> = ({ agentName, agentDescription, agentLogo, starterPrompts, agents, selectedAgentId, onAgentChange }) => {
  const { chat } = useAppState();
  const { dispatch } = useAppContext();
  const { getAccessToken } = useAuth();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Create service instances
  const apiUrl = import.meta.env.VITE_API_URL || '/api';

  const chatService = useMemo(() => {
    return new ChatService(apiUrl, getAccessToken, dispatch);
  }, [apiUrl, getAccessToken, dispatch]);

  // Sync agentId to chatService when selection changes
  useEffect(() => {
    chatService.setAgentId(selectedAgentId ?? null);
  }, [chatService, selectedAgentId]);

  // Clear chat when agent changes, then propagate
  const handleAgentChange = useCallback((newAgentId: string) => {
    chatService.clearChat();
    onAgentChange?.(newAgentId);
  }, [chatService, onAgentChange]);

  const handleSendMessage = async (text: string, files?: File[]) => {
    await chatService.sendMessage(text, chat.currentConversationId, files);
  };

  const handleClearError = () => {
    chatService.clearError();
  };

  const handleNewChat = () => {
    chatService.clearChat();
  };

  const handleCancelStream = () => {
    chatService.cancelStream();
  };

  const handleMcpApproval = async (
    approvalRequestId: string,
    approved: boolean,
    previousResponseId: string,
    conversationId: string
  ) => {
    await chatService.sendMcpApproval(approvalRequestId, approved, previousResponseId, conversationId);
  };

  return (
    <div className={styles.content}>
      <div className={styles.mainContent}>
        <ChatInterface 
          messages={chat.messages}
          status={chat.status}
          error={chat.error}
          streamingMessageId={chat.streamingMessageId}
          onSendMessage={handleSendMessage}
          onClearError={handleClearError}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onNewChat={handleNewChat}
          onCancelStream={handleCancelStream}
          onMcpApproval={handleMcpApproval}
          conversationId={chat.currentConversationId}
          hasMessages={chat.messages.length > 0}
          disabled={false}
          agentName={agentName}
          agentDescription={agentDescription}
          agentLogo={agentLogo}
          starterPrompts={starterPrompts}
        />
      </div>
      
      <SettingsPanel
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        agents={agents}
        selectedAgentId={selectedAgentId}
        onAgentChange={handleAgentChange}
        agentPickerDisabled={chat.status === 'streaming'}
      />
    </div>
  );
};

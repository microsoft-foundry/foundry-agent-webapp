import { useRef, useEffect, useState, useDeferredValue, useCallback } from "react";
import { AssistantMessage } from "./chat/AssistantMessage";
import { UserMessage } from "./chat/UserMessage";
import { McpApprovalCard } from "./chat/McpApprovalCard";
import { StarterMessages } from "./chat/StarterMessages";
import { ChatInput } from "./chat/ChatInput";
import { DropZone } from "./chat/DropZone";
import { Waves } from "./animations/Waves";
import { ErrorMessage } from "./core/ErrorMessage";
import { KeyboardShortcuts } from "./core/KeyboardShortcuts";
import { BuiltWithBadge } from "./core/BuiltWithBadge";
import type { IChatItem } from "../types/chat";
import type { IFileAttachment, PendingChatMessage, ResponseMode } from '../types/chat';
import type { AppState } from "../types/appState";
import type { AppError } from "../types/errors";
import styles from './ChatInterface.module.css';

interface ChatInterfaceProps {
  messages: IChatItem[];
  status: AppState['chat']['status'];
  error: AppError | null;
  streamingMessageId?: string;
  recoveredInput?: string;
  recoveredAttachments?: IFileAttachment[];
  recoveredMode?: ResponseMode;
  pendingMessages?: PendingChatMessage[];
  responseMode: ResponseMode;
  onResponseModeChange: (mode: ResponseMode) => void;
  onSendMessage: (text: string, files?: File[], mode?: ResponseMode) => void;
  onMcpApproval?: (approvalRequestId: string, approved: boolean, previousResponseId: string, conversationId: string) => void;
  onClearError?: () => void;
  onRecoveredInputConsumed?: () => void;
  onDequeueMessage?: (index: number) => void;
  onOpenSettings?: () => void;
  onNewChat?: () => void;
  onCancelStream?: () => void;
  onToggleSidebar?: () => void;
  onExportConversation?: () => void;
  onRegenerate?: () => void;
  onEditMessage?: (messageId: string, newText: string) => void;
  onCancelEdit?: () => void;
  isEditing?: boolean;
  onFeedback?: (messageId: string, rating: 'positive' | 'negative') => void;
  onDownloadFile?: (fileId: string, fileName: string, containerId?: string) => void;
  hasMessages?: boolean;
  disabled: boolean;
  agentName?: string;
  agentDescription?: string;
  agentLogo?: string;
  starterPrompts?: string[];
  conversationId?: string | null;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = (props) => {
  const { messages, status, error, streamingMessageId, recoveredInput, recoveredAttachments, recoveredMode, pendingMessages, responseMode, onResponseModeChange, onSendMessage, onMcpApproval, onClearError, onRecoveredInputConsumed, onDequeueMessage, onOpenSettings, onNewChat, onCancelStream, onToggleSidebar, onExportConversation, onRegenerate, onEditMessage, onCancelEdit, isEditing, onFeedback, onDownloadFile, hasMessages, disabled, agentName, agentDescription, agentLogo, starterPrompts, conversationId } = props;
  const deferredMessages = useDeferredValue(messages);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [liveRegionMessage, setLiveRegionMessage] = useState<string>('');
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | undefined>();
  const dragCounterRef = useRef(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  
  const isStreaming = status === 'streaming';
  const isBusy = disabled || status === 'sending';

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const handleShowShortcuts = useCallback(() => setIsShortcutsOpen(true), []);
  const handleDroppedFilesConsumed = useCallback(() => setDroppedFiles(undefined), []);

  // Track whether user is near the bottom via IntersectionObserver
  useEffect(() => {
    const el = messagesEndRef.current;
    if (!el) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => setIsNearBottom(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observerRef.current.observe(el);

    return () => observerRef.current?.disconnect();
  }, []);

  useEffect(() => {
    if (isNearBottom) {
      scrollToBottom();
      setHasNewMessages(false);
    } else if (messages.length > 0) {
      setHasNewMessages(true);
    }
  }, [messages, isNearBottom, scrollToBottom]);

  useEffect(() => {
    if (isStreaming) {
      const streamingMessage = messages.find(m => m.id === streamingMessageId);
      if (streamingMessage?.retryAttempt) {
        setLiveRegionMessage(`Retrying, attempt ${streamingMessage.retryAttempt} of ${streamingMessage.maxRetries}`);
      } else {
        setLiveRegionMessage('Assistant is responding');
      }
    } else if (status === 'idle' && messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      setLiveRegionMessage('Response complete');
      const timer = setTimeout(() => setLiveRegionMessage(''), 1000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, status, messages, streamingMessageId]);

  const handleSendMessage = (messageText: string, files?: File[], mode?: ResponseMode) => {
    if (!messageText.trim() || disabled) return;
    onSendMessage(messageText, files, mode);
  };

  const handleStarterPromptClick = (prompt: string) => {
    handleSendMessage(prompt);
  };

  // Drag-drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setDroppedFiles(files);
    }
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl/Cmd+N → new chat
      if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onNewChat?.();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNewChat]);

  return (
    <div
      className={styles.chatContainer}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <DropZone visible={isDragging} />
      <KeyboardShortcuts open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen} />
      {/* Live region for announcing streaming status to screen readers */}
      <div 
        role="status" 
        aria-live="polite" 
        aria-atomic="true"
        className="sr-only"
      >
        {liveRegionMessage}
      </div>

      <div 
        className={styles.messagesContainer} 
        role="log" 
        aria-live="polite" 
        aria-label="Chat messages"
        aria-busy={isStreaming}
      >
        <div className={styles.messagesWrapper}>
          {messages.length === 0 ? (
            <StarterMessages 
              agentName={agentName}
              agentDescription={agentDescription}
              agentLogo={agentLogo}
              starterPrompts={starterPrompts}
              onPromptClick={handleStarterPromptClick}
            />
          ) : (
            <>
              <div aria-live="polite" aria-atomic="false" className="sr-only">
                {messages.length > 0 && messages[messages.length - 1].role === 'assistant' && 
                  `Assistant: ${messages[messages.length - 1].content.substring(0, 100)}`
                }
              </div>
              {(() => {
                let lastUserIdx = -1;
                for (let i = deferredMessages.length - 1; i >= 0; i--) {
                  if (deferredMessages[i].role === 'user') { lastUserIdx = i; break; }
                }
                return deferredMessages.map((message, index) => {
                const isLastUserMessage = message.role === 'user' && index === lastUserIdx && !isStreaming;
                return message.role === "approval" ? (
                  <McpApprovalCard
                    key={message.id}
                    toolName={message.mcpApproval?.toolName || ''}
                    serverLabel={message.mcpApproval?.serverLabel || ''}
                    arguments={message.mcpApproval?.arguments}
                    resolved={message.mcpApproval?.resolved}
                    onApprove={() => onMcpApproval?.(
                      message.mcpApproval!.id,
                      true,
                      message.mcpApproval!.previousResponseId || '',
                      conversationId || ''
                    )}
                    onReject={() => onMcpApproval?.(
                      message.mcpApproval!.id,
                      false,
                      message.mcpApproval!.previousResponseId || '',
                      conversationId || ''
                    )}
                    disabled={isBusy}
                    agentName={agentName}
                    agentLogo={agentLogo}
                  />
                ) : message.role === "user" ? (
                  <UserMessage 
                    key={message.id} 
                    message={message}
                    isLastUserMessage={isLastUserMessage}
                    onEdit={onEditMessage}
                  />
                ) : (
                  <AssistantMessage 
                    key={message.id} 
                    message={message} 
                    isStreaming={isStreaming && message.id === streamingMessageId}
                    agentName={agentName}
                    agentLogo={agentLogo}
                    onRegenerate={onRegenerate}
                    onFeedback={onFeedback}
                    onDownloadFile={onDownloadFile}
                  />
                );
              })
              })()}
              <div ref={messagesEndRef} style={{ height: '1px' }} />
            </>
          )}
        </div>
        {hasNewMessages && !isNearBottom && (
          <button
            className={styles.newMessagesPill}
            onClick={() => { scrollToBottom(); setHasNewMessages(false); }}
            aria-label="Scroll to new messages"
          >
            ↓ New messages
          </button>
        )}
      </div>

      <div className={styles.chatInputArea}>
        {error && (
          <div className={styles.errorWrapper}>
            <ErrorMessage
              message={typeof error.message === 'string' ? error.message : 
                      typeof error === 'string' ? error :
                      error.originalError?.message || 
                      'An unexpected error occurred. Please try again.'}
              recoverable={error.recoverable}
              onRetry={error.action?.handler}
              onDismiss={onClearError}
              customAction={error.action && error.action.label !== 'Retry' ? {
                label: error.action.label,
                handler: error.action.handler
              } : undefined}
            />
          </div>
        )}

        <Waves />
        <ChatInput
          onSubmit={handleSendMessage}
          responseMode={responseMode}
          onResponseModeChange={onResponseModeChange}
          disabled={isBusy}
          onOpenSettings={onOpenSettings}
          onNewChat={onNewChat}
          onToggleSidebar={onToggleSidebar}
          hasMessages={hasMessages}
          placeholder="Type your message here..."
          isStreaming={isStreaming}
          onCancelStream={isStreaming && onCancelStream ? onCancelStream : undefined}
          isEditing={isEditing}
          onCancelEdit={onCancelEdit}
          onExportConversation={onExportConversation}
          onShowShortcuts={handleShowShortcuts}
          recoveredInput={recoveredInput}
          recoveredAttachments={recoveredAttachments}
          recoveredMode={recoveredMode}
          onRecoveredInputConsumed={onRecoveredInputConsumed}
          pendingMessages={pendingMessages}
          onDequeueMessage={onDequeueMessage}
          droppedFiles={droppedFiles}
          onDroppedFilesConsumed={handleDroppedFilesConsumed}
        />
        <BuiltWithBadge className={styles.builtWithBadge} />
      </div>
    </div>
  );
};

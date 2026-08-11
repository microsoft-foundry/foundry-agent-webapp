import type { AppState, AppAction } from '../types/appState';

/**
 * Main application state reducer.
 * Handles all state transitions for auth, chat, and UI coordination.
 * 
 * Design principles:
 * - Pure function - no side effects
 * - Immutable updates - always return new state objects
 * - Exhaustive action handling via discriminated unions
 * - Optimized updates - only modify what changed
 * 
 * @param state - Current application state
 * @param action - Action to process (discriminated union)
 * @returns New application state
 */
export const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    // === Authentication Actions ===
    case 'AUTH_INITIALIZED':
      return {
        ...state,
        auth: {
          status: 'authenticated',
          user: action.user,
          error: null,
        },
      };

    case 'AUTH_TOKEN_EXPIRED':
      return {
        ...state,
        auth: {
          ...state.auth,
          status: 'unauthenticated',
        },
      };

    // === Chat Message Actions ===
    case 'CHAT_SEND_MESSAGE':
      return {
        ...state,
        chat: {
          ...state.chat,
          status: 'sending',
          messages: [...state.chat.messages, action.message],
          editSnapshot: undefined,
        },
      };

    case 'CHAT_LOAD_MESSAGES':
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: [...state.chat.messages, ...action.messages],
        },
      };

    case 'CHAT_LOAD_CONVERSATION':
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: action.messages,
          status: 'idle',
          currentConversationId: action.conversationId,
          streamingMessageId: undefined,
          error: null,
          pendingMessages: [],
          editSnapshot: undefined,
          recoveredAttachments: undefined,
          recoveredMode: undefined,
        },
        ui: {
          ...state.ui,
          chatInputEnabled: true,
        },
      };

    case 'CHAT_ADD_ASSISTANT_MESSAGE':
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: [
            ...state.chat.messages,
            {
              id: action.messageId,
              role: 'assistant' as const,
              content: '',
              more: {
                time: new Date().toISOString(),
              },
            },
          ],
        },
      };

    // === Chat Streaming Actions ===
    case 'CHAT_START_STREAM':
      return {
        ...state,
        chat: {
          ...state.chat,
          status: 'streaming',
          currentConversationId: action.conversationId || state.chat.currentConversationId,
          streamingMessageId: action.messageId,
          error: null,
        },
        ui: {
          ...state.ui,
          chatInputEnabled: true,
        },
      };

    case 'CHAT_STREAM_CHUNK': {
      // Performance optimization: only update the specific message being streamed
      const messageIndex = state.chat.messages.findIndex(
        msg => msg.id === action.messageId
      );
      
      if (messageIndex === -1) {
        // Message not found - return unchanged state
        return state;
      }
      
      // Create new array with updated message
      const updatedMessages = [...state.chat.messages];
      updatedMessages[messageIndex] = {
        ...updatedMessages[messageIndex],
        content: updatedMessages[messageIndex].content + action.content,
      };
      
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: updatedMessages,
        },
      };
    }

    case 'CHAT_STREAM_ANNOTATIONS': {
      // Add annotations to the streaming message
      const messageIndex = state.chat.messages.findIndex(
        msg => msg.id === action.messageId
      );
      
      if (messageIndex === -1) {
        return state;
      }
      
      const updatedMessages = [...state.chat.messages];
      const existingAnnotations = updatedMessages[messageIndex].annotations || [];
      updatedMessages[messageIndex] = {
        ...updatedMessages[messageIndex],
        annotations: [...existingAnnotations, ...action.annotations],
      };
      
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: updatedMessages,
        },
      };
    }

    case 'CHAT_STREAM_TOOL_USE': {
      // Set activeToolUse on the streaming message for progress indicator
      const messageIndex = state.chat.messages.findIndex(
        msg => msg.id === action.messageId
      );

      if (messageIndex === -1) {
        return state;
      }

      const updatedMessages = [...state.chat.messages];
      updatedMessages[messageIndex] = {
        ...updatedMessages[messageIndex],
        activeToolUse: action.toolName,
      };

      return {
        ...state,
        chat: {
          ...state.chat,
          messages: updatedMessages,
        },
      };
    }

    case 'CHAT_MCP_APPROVAL_REQUEST': {
      // Add approval request as a special message
      const approvalMessage = {
        id: `approval-${action.messageId}`,
        role: 'approval' as const,
        content: '',
        mcpApproval: {
          ...action.approvalRequest,
          previousResponseId: action.previousResponseId || '',
        },
      };
      
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: [...state.chat.messages, approvalMessage],
          status: 'idle',
        },
        ui: {
          ...state.ui,
          chatInputEnabled: false, // Keep disabled until approval
        },
      };
    }

    case 'CHAT_MCP_APPROVAL_RESOLVED': {
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: state.chat.messages.map(msg =>
            msg.role === 'approval' && msg.mcpApproval?.id === action.approvalRequestId
              ? { ...msg, mcpApproval: { ...msg.mcpApproval!, resolved: action.resolved } }
              : msg
          ),
        },
      };
    }

    case 'CHAT_STREAM_COMPLETE': {
      // Update the completed message with usage info and clean up retry/tool state
      const updatedMessages = state.chat.messages.map(msg =>
        msg.id === state.chat.streamingMessageId
          ? {
              ...msg,
              more: {
                ...msg.more,
                usage: action.usage,
              },
              duration: action.usage.duration,
              retryAttempt: undefined,
              maxRetries: undefined,
              activeToolUse: undefined,
            }
          : msg
      );

      return {
        ...state,
        chat: {
          ...state.chat,
          status: 'idle',
          streamingMessageId: undefined,
          messages: updatedMessages,
        },
        ui: {
          ...state.ui,
          chatInputEnabled: true,
        },
      };
    }

    case 'CHAT_CANCEL_STREAM':
      return {
        ...state,
        chat: {
          ...state.chat,
          status: 'idle',
          streamingMessageId: undefined,
        },
        ui: {
          ...state.ui,
          chatInputEnabled: true,
        },
      };

    // === Chat Error Handling ===
    case 'CHAT_ERROR':
      return {
        ...state,
        chat: {
          ...state.chat,
          status: 'error',
          error: action.error,
          streamingMessageId: undefined,
        },
        ui: {
          ...state.ui,
          chatInputEnabled: action.error.recoverable,
        },
      };

    case 'CHAT_CLEAR_ERROR':
      return {
        ...state,
        chat: {
          ...state.chat,
          error: null,
          status: 'idle',
          recoveredInput: undefined, recoveredAttachments: undefined,
          recoveredMode: undefined,
        },
        ui: {
          ...state.ui,
          chatInputEnabled: true,
        },
      };

    case 'CHAT_CLEAR':
      return {
        ...state,
        chat: {
          status: 'idle',
          messages: [],
          currentConversationId: null,
          error: null,
          streamingMessageId: undefined,
          recoveredInput: undefined, recoveredAttachments: undefined,
          recoveredMode: undefined,
          pendingMessages: [],
        },
        ui: {
          ...state.ui,
          chatInputEnabled: true,
        },
      };

    // === Stream Retry & Recovery ===
    case 'CHAT_STREAM_RETRY': {
      const retryIndex = state.chat.messages.findIndex(msg => msg.id === action.messageId);
      if (retryIndex === -1) return state;

      const updatedMessages = [...state.chat.messages];
      updatedMessages[retryIndex] = {
        ...updatedMessages[retryIndex],
        content: '',
        annotations: undefined,
        retryAttempt: action.attempt,
        maxRetries: action.maxRetries,
      };
      return {
        ...state,
        chat: {
          ...state.chat,
          status: 'streaming',
          messages: updatedMessages,
          streamingMessageId: action.messageId,
          error: null,
        },
        ui: {
          ...state.ui,
          chatInputEnabled: true,
        },
      };
    }

    case 'CHAT_RECOVER_MESSAGE': {
      const recoveredMessages = state.chat.messages.length >= 2
        ? state.chat.messages.slice(0, -2)
        : [];
      return {
        ...state,
        chat: {
          ...state.chat,
          status: 'error',
          messages: recoveredMessages,
          streamingMessageId: undefined,
          recoveredInput: action.messageText,
          recoveredMode: action.mode,
          error: {
            ...action.error,
            message: `Failed to get a response after ${action.retryCount} ${action.retryCount === 1 ? 'attempt' : 'attempts'}. Your message has been restored.`,
            recoverable: true,
          },
        },
        ui: {
          ...state.ui,
          chatInputEnabled: true,
        },
      };
    }

    case 'CHAT_CONSUMED_RECOVERED_INPUT':
      return {
        ...state,
        chat: {
          ...state.chat,
          recoveredInput: undefined, recoveredAttachments: undefined,
          recoveredMode: undefined,
        },
      };

    // === Message Queue ===
    case 'CHAT_QUEUE_MESSAGE':
      return {
        ...state,
        chat: {
          ...state.chat,
          pendingMessages: [...state.chat.pendingMessages, { text: action.text, files: action.files, mode: action.mode }],
        },
      };

    case 'CHAT_DEQUEUE_MESSAGE':
      return {
        ...state,
        chat: {
          ...state.chat,
          pendingMessages: state.chat.pendingMessages.filter((_, i) => i !== action.index),
        },
      };

    case 'CHAT_CLEAR_QUEUE':
      return {
        ...state,
        chat: {
          ...state.chat,
          pendingMessages: [],
        },
      };

    // === Regenerate & Edit ===
    case 'CHAT_REGENERATE': {
      // Remove the last assistant message AND its preceding user message;
      // store the user text for auto-resend so AgentChat creates a fresh pair.
      const msgs = state.chat.messages;
      const lastAssistantIdx = msgs.length - 1;
      if (lastAssistantIdx < 0 || msgs[lastAssistantIdx].role !== 'assistant') return state;

      // Find the user message that preceded the assistant message
      let lastUserIdx = -1;
      for (let i = lastAssistantIdx - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') { lastUserIdx = i; break; }
      }

      const regenerateText = lastUserIdx >= 0 ? msgs[lastUserIdx].content : undefined;
      const sliceEnd = lastUserIdx >= 0 ? lastUserIdx : lastAssistantIdx;

      return {
        ...state,
        chat: {
          ...state.chat,
          messages: msgs.slice(0, sliceEnd),
          status: 'idle',
          streamingMessageId: undefined,
          regenerateText,
        },
        ui: {
          ...state.ui,
          chatInputEnabled: true,
        },
      };
    }

    case 'CHAT_EDIT_MESSAGE': {
      const targetIdx = state.chat.messages.findIndex(m => m.id === action.messageId);
      if (targetIdx === -1) return state;
      const targetMsg = state.chat.messages[targetIdx];
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: state.chat.messages.slice(0, targetIdx),
          status: 'idle',
          streamingMessageId: undefined,
          recoveredInput: action.newText,
          recoveredAttachments: targetMsg.attachments,
          editSnapshot: state.chat.messages.slice(targetIdx),
        },
        ui: {
          ...state.ui,
          chatInputEnabled: true,
        },
      };
    }

    case 'CHAT_CANCEL_EDIT': {
      if (!state.chat.editSnapshot) return state;
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: [...state.chat.messages, ...state.chat.editSnapshot],
          editSnapshot: undefined,
          recoveredInput: undefined, recoveredAttachments: undefined,
        },
      };
    }

    case 'CHAT_CONSUMED_REGENERATE':
      return {
        ...state,
        chat: {
          ...state.chat,
          regenerateText: undefined,
        },
      };

    // === Conversation History Actions ===
    case 'CONVERSATIONS_LOADING':
      return {
        ...state,
        conversations: {
          ...state.conversations,
          isLoading: true,
        },
      };

    case 'CONVERSATIONS_LOADING_DONE':
      return {
        ...state,
        conversations: {
          ...state.conversations,
          isLoading: false,
        },
      };

    case 'CONVERSATIONS_SET_LIST': {
      const combined = action.append
        ? [...state.conversations.list, ...action.conversations]
        : action.conversations;
      // Deduplicate by ID (server list order can shift between fetches)
      const seen = new Set<string>();
      const deduped = combined.filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      return {
        ...state,
        conversations: {
          ...state.conversations,
          list: deduped,
          isLoading: false,
          hasMore: action.hasMore,
        },
      };
    }

    case 'CONVERSATIONS_TOGGLE_SIDEBAR':
      return {
        ...state,
        conversations: {
          ...state.conversations,
          sidebarOpen: !state.conversations.sidebarOpen,
        },
      };

    case 'CONVERSATIONS_REMOVE':
      return {
        ...state,
        conversations: {
          ...state.conversations,
          list: state.conversations.list.filter(c => c.id !== action.conversationId),
        },
      };

    default:
      // TypeScript ensures all actions are handled (exhaustiveness check)
      return state;
  }
};

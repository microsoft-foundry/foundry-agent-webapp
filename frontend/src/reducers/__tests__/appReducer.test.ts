import { describe, it, expect } from 'vitest';
import { appReducer } from '../appReducer';
import { initialAppState } from '../../types/appState';
import type { AppState, AppAction, IChatItem, IAnnotation } from '../../types/appState';
import type { AccountInfo } from '@azure/msal-browser';

// Initial state factory for clean test isolation
function createInitialState(): AppState {
  return {
    auth: {
      status: 'unauthenticated',
      user: null,
      error: null,
    },
    chat: {
      status: 'idle',
      messages: [],
      currentConversationId: null,
      error: null,
      streamingMessageId: undefined,
      recoveredInput: undefined,
      recoveredAttachments: undefined,
      editSnapshot: undefined,
      regenerateText: undefined,
      pendingMessages: [],
    },
    ui: {
      chatInputEnabled: true,
    },
    conversations: {
      list: [],
      isLoading: false,
      sidebarOpen: false,
      hasMore: false,
    },
  };
}

// Mock message factory
function createMockMessage(overrides: Partial<IChatItem> = {}): IChatItem {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Test message',
    more: { time: new Date().toISOString() },
    ...overrides,
  };
}

// Mock AccountInfo factory
function createMockUser(overrides: Partial<AccountInfo> = {}): AccountInfo {
  return {
    homeAccountId: 'home-account-1',
    environment: 'login.microsoftonline.com',
    tenantId: 'tenant-1',
    username: 'test@example.com',
    localAccountId: 'local-1',
    name: 'Test User',
    ...overrides,
  };
}

describe('appReducer', () => {
  describe('AUTH_INITIALIZED', () => {
    it('sets status to authenticated with user', () => {
      const state = createInitialState();
      const user = createMockUser();
      const action: AppAction = { type: 'AUTH_INITIALIZED', user };

      const result = appReducer(state, action);

      expect(result.auth.status).toBe('authenticated');
      expect(result.auth.user).toEqual(user);
      expect(result.auth.error).toBeNull();
    });
  });

  describe('AUTH_TOKEN_EXPIRED', () => {
    it('sets status to unauthenticated', () => {
      const state = createInitialState();
      state.auth.status = 'authenticated';
      const action: AppAction = { type: 'AUTH_TOKEN_EXPIRED' };

      const result = appReducer(state, action);

      expect(result.auth.status).toBe('unauthenticated');
    });
  });

  describe('CHAT_SEND_MESSAGE', () => {
    it('adds message to messages array', () => {
      const state = createInitialState();
      const message = createMockMessage();
      const action: AppAction = { type: 'CHAT_SEND_MESSAGE', message };

      const result = appReducer(state, action);

      expect(result.chat.messages).toHaveLength(1);
      expect(result.chat.messages[0]).toEqual(message);
    });

    it('sets status to sending', () => {
      const state = createInitialState();
      const message = createMockMessage();
      const action: AppAction = { type: 'CHAT_SEND_MESSAGE', message };

      const result = appReducer(state, action);

      expect(result.chat.status).toBe('sending');
    });

    it('preserves existing messages', () => {
      const state = createInitialState();
      const existingMessage = createMockMessage({ id: 'existing-1' });
      state.chat.messages = [existingMessage];

      const newMessage = createMockMessage({ id: 'new-1' });
      const action: AppAction = { type: 'CHAT_SEND_MESSAGE', message: newMessage };

      const result = appReducer(state, action);

      expect(result.chat.messages).toHaveLength(2);
      expect(result.chat.messages[0]).toEqual(existingMessage);
    });
  });

  describe('CHAT_LOAD_MESSAGES', () => {
    it('appends messages to existing messages', () => {
      const state = createInitialState();
      const existing = createMockMessage({ id: 'existing-1' });
      state.chat.messages = [existing];

      const loaded = [
        createMockMessage({ id: 'loaded-1', content: 'Hello' }),
        createMockMessage({ id: 'loaded-2', content: 'World' }),
      ];
      const action: AppAction = { type: 'CHAT_LOAD_MESSAGES', messages: loaded };

      const result = appReducer(state, action);

      expect(result.chat.messages).toHaveLength(3);
      expect(result.chat.messages[0]).toEqual(existing);
      expect(result.chat.messages[1]).toEqual(loaded[0]);
      expect(result.chat.messages[2]).toEqual(loaded[1]);
    });

    it('is a no-op when messages array is empty', () => {
      const state = createInitialState();
      const existing = createMockMessage({ id: 'existing-1' });
      state.chat.messages = [existing];

      const action: AppAction = { type: 'CHAT_LOAD_MESSAGES', messages: [] };

      const result = appReducer(state, action);

      expect(result.chat.messages).toHaveLength(1);
      expect(result.chat.messages[0]).toEqual(existing);
    });

    it('does NOT change chat.status', () => {
      const state = createInitialState();
      state.chat.status = 'idle';

      const action: AppAction = {
        type: 'CHAT_LOAD_MESSAGES',
        messages: [createMockMessage({ id: 'msg-1' })],
      };

      const result = appReducer(state, action);

      expect(result.chat.status).toBe('idle');
    });
  });

  describe('CHAT_ADD_ASSISTANT_MESSAGE', () => {
    it('adds empty assistant message', () => {
      const state = createInitialState();
      const action: AppAction = { type: 'CHAT_ADD_ASSISTANT_MESSAGE', messageId: 'assistant-1' };

      const result = appReducer(state, action);

      expect(result.chat.messages).toHaveLength(1);
      expect(result.chat.messages[0].role).toBe('assistant');
      expect(result.chat.messages[0].content).toBe('');
      expect(result.chat.messages[0].id).toBe('assistant-1');
    });
  });

  describe('CHAT_START_STREAM', () => {
    it('sets status to streaming', () => {
      const state = createInitialState();
      const action: AppAction = {
        type: 'CHAT_START_STREAM',
        conversationId: 'conv-1',
        messageId: 'msg-1',
      };

      const result = appReducer(state, action);

      expect(result.chat.status).toBe('streaming');
    });

    it('stores conversationId and streamingMessageId', () => {
      const state = createInitialState();
      const action: AppAction = {
        type: 'CHAT_START_STREAM',
        conversationId: 'conv-123',
        messageId: 'msg-456',
      };

      const result = appReducer(state, action);

      expect(result.chat.currentConversationId).toBe('conv-123');
      expect(result.chat.streamingMessageId).toBe('msg-456');
    });

    it('keeps chat input enabled for message queueing', () => {
      const state = createInitialState();
      const action: AppAction = {
        type: 'CHAT_START_STREAM',
        conversationId: 'conv-1',
        messageId: 'msg-1',
      };

      const result = appReducer(state, action);

      expect(result.ui.chatInputEnabled).toBe(true);
    });

    it('clears any existing error', () => {
      const state = createInitialState();
      state.chat.error = { code: 'NETWORK', message: 'Old error', recoverable: true };
      const action: AppAction = {
        type: 'CHAT_START_STREAM',
        conversationId: 'conv-1',
        messageId: 'msg-1',
      };

      const result = appReducer(state, action);

      expect(result.chat.error).toBeNull();
    });
  });

  describe('CHAT_STREAM_CHUNK', () => {
    it('appends content to the streaming message', () => {
      const state = createInitialState();
      state.chat.messages = [createMockMessage({ id: 'msg-1', role: 'assistant', content: 'Hello' })];

      const action: AppAction = {
        type: 'CHAT_STREAM_CHUNK',
        messageId: 'msg-1',
        content: ' World',
      };

      const result = appReducer(state, action);

      expect(result.chat.messages[0].content).toBe('Hello World');
    });

    it('returns unchanged state if message not found', () => {
      const state = createInitialState();
      state.chat.messages = [createMockMessage({ id: 'msg-1' })];

      const action: AppAction = {
        type: 'CHAT_STREAM_CHUNK',
        messageId: 'non-existent',
        content: ' chunk',
      };

      const result = appReducer(state, action);

      expect(result).toEqual(state);
    });
  });

  describe('CHAT_STREAM_ANNOTATIONS', () => {
    it('adds annotations to the streaming message', () => {
      const state = createInitialState();
      state.chat.messages = [createMockMessage({ id: 'msg-1', role: 'assistant', content: 'Test' })];

      const annotations: IAnnotation[] = [
        { type: 'uri_citation', label: 'Source', url: 'https://example.com' },
      ];
      const action: AppAction = {
        type: 'CHAT_STREAM_ANNOTATIONS',
        messageId: 'msg-1',
        annotations,
      };

      const result = appReducer(state, action);

      expect(result.chat.messages[0].annotations).toHaveLength(1);
    });

    it('appends to existing annotations', () => {
      const state = createInitialState();
      const existingAnnotation: IAnnotation = { type: 'uri_citation', label: 'Old' };
      state.chat.messages = [
        createMockMessage({ id: 'msg-1', role: 'assistant', annotations: [existingAnnotation] }),
      ];

      const newAnnotations: IAnnotation[] = [{ type: 'file_citation', label: 'New' }];
      const action: AppAction = {
        type: 'CHAT_STREAM_ANNOTATIONS',
        messageId: 'msg-1',
        annotations: newAnnotations,
      };

      const result = appReducer(state, action);

      expect(result.chat.messages[0].annotations).toHaveLength(2);
    });

    it('returns unchanged state if message not found', () => {
      const state = createInitialState();
      state.chat.messages = [createMockMessage({ id: 'msg-1', role: 'assistant' })];

      const annotations: IAnnotation[] = [{ type: 'uri_citation', label: 'Source' }];
      const action: AppAction = {
        type: 'CHAT_STREAM_ANNOTATIONS',
        messageId: 'non-existent',
        annotations,
      };

      const result = appReducer(state, action);

      expect(result).toEqual(state);
    });
  });

  describe('CHAT_MCP_APPROVAL_REQUEST', () => {
    it('adds approval message with mcpApproval data', () => {
      const state = createInitialState();
      const approvalRequest = {
        id: 'approval-123',
        toolName: 'read_file',
        serverLabel: 'File System',
        arguments: '{"path": "/test"}',
      };
      const action: AppAction = {
        type: 'CHAT_MCP_APPROVAL_REQUEST',
        messageId: 'msg-1',
        approvalRequest,
        previousResponseId: 'prev-response-1',
      };

      const result = appReducer(state, action);

      expect(result.chat.messages).toHaveLength(1);
      expect(result.chat.messages[0].role).toBe('approval');
      expect(result.chat.messages[0].mcpApproval).toBeDefined();
      expect(result.chat.messages[0].mcpApproval?.toolName).toBe('read_file');
      expect(result.chat.messages[0].mcpApproval?.serverLabel).toBe('File System');
    });

    it('sets status to idle', () => {
      const state = createInitialState();
      state.chat.status = 'streaming';
      const approvalRequest = {
        id: 'approval-123',
        toolName: 'test_tool',
        serverLabel: 'Test',
      };

      const result = appReducer(state, {
        type: 'CHAT_MCP_APPROVAL_REQUEST',
        messageId: 'msg-1',
        approvalRequest,
        previousResponseId: null,
      });

      expect(result.chat.status).toBe('idle');
    });

    it('disables chat input until approval', () => {
      const state = createInitialState();
      state.ui.chatInputEnabled = true;
      const approvalRequest = {
        id: 'approval-123',
        toolName: 'test_tool',
        serverLabel: 'Test',
      };

      const result = appReducer(state, {
        type: 'CHAT_MCP_APPROVAL_REQUEST',
        messageId: 'msg-1',
        approvalRequest,
        previousResponseId: null,
      });

      expect(result.ui.chatInputEnabled).toBe(false);
    });

    it('handles null previousResponseId', () => {
      const state = createInitialState();
      const approvalRequest = {
        id: 'approval-123',
        toolName: 'test_tool',
        serverLabel: 'Test',
      };

      const result = appReducer(state, {
        type: 'CHAT_MCP_APPROVAL_REQUEST',
        messageId: 'msg-1',
        approvalRequest,
        previousResponseId: null,
      });

      expect(result.chat.messages[0].mcpApproval?.previousResponseId).toBe('');
    });
  });

  describe('CHAT_MCP_APPROVAL_RESOLVED', () => {
    it('sets resolved to approved on matching approval message', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({
          id: 'approval-msg-1',
          role: 'approval',
          mcpApproval: {
            id: 'req-123',
            toolName: 'read_file',
            serverLabel: 'FS',
            previousResponseId: 'prev-1',
          },
        }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_MCP_APPROVAL_RESOLVED',
        approvalRequestId: 'req-123',
        resolved: 'approved',
      });

      expect(result.chat.messages[0].mcpApproval?.resolved).toBe('approved');
    });

    it('sets resolved to rejected on matching approval message', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({
          id: 'approval-msg-1',
          role: 'approval',
          mcpApproval: {
            id: 'req-456',
            toolName: 'write_file',
            serverLabel: 'FS',
            previousResponseId: 'prev-1',
          },
        }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_MCP_APPROVAL_RESOLVED',
        approvalRequestId: 'req-456',
        resolved: 'rejected',
      });

      expect(result.chat.messages[0].mcpApproval?.resolved).toBe('rejected');
    });

    it('does not change non-matching messages', () => {
      const state = createInitialState();
      const otherMsg = createMockMessage({ id: 'other-msg', role: 'user', content: 'Hello' });
      const approvalMsg = createMockMessage({
        id: 'approval-msg',
        role: 'approval',
        mcpApproval: {
          id: 'req-999',
          toolName: 'tool',
          serverLabel: 'S',
          previousResponseId: '',
        },
      });
      state.chat.messages = [otherMsg, approvalMsg];

      const result = appReducer(state, {
        type: 'CHAT_MCP_APPROVAL_RESOLVED',
        approvalRequestId: 'req-999',
        resolved: 'approved',
      });

      expect(result.chat.messages[0]).toEqual(otherMsg);
      expect(result.chat.messages[1].mcpApproval?.resolved).toBe('approved');
    });

    it('does not crash with non-existent approvalRequestId', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({
          id: 'approval-msg',
          role: 'approval',
          mcpApproval: {
            id: 'req-existing',
            toolName: 'tool',
            serverLabel: 'S',
            previousResponseId: '',
          },
        }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_MCP_APPROVAL_RESOLVED',
        approvalRequestId: 'req-nonexistent',
        resolved: 'approved',
      });

      expect(result.chat.messages[0].mcpApproval?.resolved).toBeUndefined();
    });
  });

  describe('CHAT_STREAM_COMPLETE', () => {
    it('sets status to idle', () => {
      const state = createInitialState();
      state.chat.status = 'streaming';
      state.chat.streamingMessageId = 'msg-1';
      state.chat.messages = [createMockMessage({ id: 'msg-1', role: 'assistant' })];

      const action: AppAction = {
        type: 'CHAT_STREAM_COMPLETE',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, duration: 1234 },
      };

      const result = appReducer(state, action);

      expect(result.chat.status).toBe('idle');
    });

    it('clears streamingMessageId', () => {
      const state = createInitialState();
      state.chat.streamingMessageId = 'msg-1';
      state.chat.messages = [createMockMessage({ id: 'msg-1', role: 'assistant' })];

      const action: AppAction = {
        type: 'CHAT_STREAM_COMPLETE',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, duration: 1234 },
      };

      const result = appReducer(state, action);

      expect(result.chat.streamingMessageId).toBeUndefined();
    });

    it('enables chat input', () => {
      const state = createInitialState();
      state.ui.chatInputEnabled = false;
      state.chat.streamingMessageId = 'msg-1';
      state.chat.messages = [createMockMessage({ id: 'msg-1', role: 'assistant' })];

      const action: AppAction = {
        type: 'CHAT_STREAM_COMPLETE',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, duration: 1234 },
      };

      const result = appReducer(state, action);

      expect(result.ui.chatInputEnabled).toBe(true);
    });

    it('adds usage info and duration to the message', () => {
      const state = createInitialState();
      state.chat.streamingMessageId = 'msg-1';
      state.chat.messages = [createMockMessage({ id: 'msg-1', role: 'assistant' })];

      const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150, duration: 1234 };
      const action: AppAction = { type: 'CHAT_STREAM_COMPLETE', usage };

      const result = appReducer(state, action);

      expect(result.chat.messages[0].more?.usage).toEqual(usage);
      expect(result.chat.messages[0].duration).toBe(1234);
    });
  });

  describe('CHAT_CANCEL_STREAM', () => {
    it('sets status to idle', () => {
      const state = createInitialState();
      state.chat.status = 'streaming';

      const result = appReducer(state, { type: 'CHAT_CANCEL_STREAM' });

      expect(result.chat.status).toBe('idle');
    });

    it('clears streamingMessageId', () => {
      const state = createInitialState();
      state.chat.streamingMessageId = 'msg-1';

      const result = appReducer(state, { type: 'CHAT_CANCEL_STREAM' });

      expect(result.chat.streamingMessageId).toBeUndefined();
    });

    it('enables chat input', () => {
      const state = createInitialState();
      state.ui.chatInputEnabled = false;

      const result = appReducer(state, { type: 'CHAT_CANCEL_STREAM' });

      expect(result.ui.chatInputEnabled).toBe(true);
    });
  });

  describe('CHAT_ERROR', () => {
    it('sets status to error with error details', () => {
      const state = createInitialState();
      const error = { code: 'NETWORK' as const, message: 'Connection failed', recoverable: true };

      const result = appReducer(state, { type: 'CHAT_ERROR', error });

      expect(result.chat.status).toBe('error');
      expect(result.chat.error).toEqual(error);
    });

    it('enables input for recoverable errors', () => {
      const state = createInitialState();
      state.ui.chatInputEnabled = false;
      const error = { code: 'NETWORK' as const, message: 'Timeout', recoverable: true };

      const result = appReducer(state, { type: 'CHAT_ERROR', error });

      expect(result.ui.chatInputEnabled).toBe(true);
    });

    it('disables input for non-recoverable errors', () => {
      const state = createInitialState();
      const error = { code: 'AUTH' as const, message: 'Session expired', recoverable: false };

      const result = appReducer(state, { type: 'CHAT_ERROR', error });

      expect(result.ui.chatInputEnabled).toBe(false);
    });

    it('clears streamingMessageId', () => {
      const state = createInitialState();
      state.chat.streamingMessageId = 'msg-1';
      const error = { code: 'NETWORK' as const, message: 'Error', recoverable: true };

      const result = appReducer(state, { type: 'CHAT_ERROR', error });

      expect(result.chat.streamingMessageId).toBeUndefined();
    });
  });

  describe('CHAT_CLEAR_ERROR', () => {
    it('clears error and sets status to idle', () => {
      const state = createInitialState();
      state.chat.status = 'error';
      state.chat.error = { code: 'NETWORK', message: 'Old error', recoverable: true };

      const result = appReducer(state, { type: 'CHAT_CLEAR_ERROR' });

      expect(result.chat.error).toBeNull();
      expect(result.chat.status).toBe('idle');
    });

    it('enables chat input', () => {
      const state = createInitialState();
      state.ui.chatInputEnabled = false;

      const result = appReducer(state, { type: 'CHAT_CLEAR_ERROR' });

      expect(result.ui.chatInputEnabled).toBe(true);
    });
  });

  describe('CHAT_CLEAR', () => {
    it('clears all messages', () => {
      const state = createInitialState();
      state.chat.messages = [createMockMessage(), createMockMessage({ id: 'msg-2' })];

      const result = appReducer(state, { type: 'CHAT_CLEAR' });

      expect(result.chat.messages).toHaveLength(0);
    });

    it('resets conversationId to null', () => {
      const state = createInitialState();
      state.chat.currentConversationId = 'conv-123';

      const result = appReducer(state, { type: 'CHAT_CLEAR' });

      expect(result.chat.currentConversationId).toBeNull();
    });

    it('sets status to idle', () => {
      const state = createInitialState();
      state.chat.status = 'streaming';

      const result = appReducer(state, { type: 'CHAT_CLEAR' });

      expect(result.chat.status).toBe('idle');
    });

    it('enables chat input', () => {
      const state = createInitialState();
      state.ui.chatInputEnabled = false;

      const result = appReducer(state, { type: 'CHAT_CLEAR' });

      expect(result.ui.chatInputEnabled).toBe(true);
    });

    it('clears any existing error', () => {
      const state = createInitialState();
      state.chat.error = { code: 'NETWORK', message: 'Error', recoverable: true };

      const result = appReducer(state, { type: 'CHAT_CLEAR' });

      expect(result.chat.error).toBeNull();
    });

    it('clears recoveredInput', () => {
      const state = createInitialState();
      state.chat.recoveredInput = 'leftover text';

      const result = appReducer(state, { type: 'CHAT_CLEAR' });

      expect(result.chat.recoveredInput).toBeUndefined();
    });
  });

  describe('CHAT_STREAM_RETRY', () => {
    it('resets assistant message content and sets retry metadata', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user', content: 'Hello' }),
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: 'partial response' }),
      ];
      state.chat.streamingMessageId = 'assistant-1';

      const result = appReducer(state, {
        type: 'CHAT_STREAM_RETRY',
        messageId: 'assistant-1',
        attempt: 2,
        maxRetries: 3,
      });

      const assistantMsg = result.chat.messages.find(m => m.id === 'assistant-1');
      expect(assistantMsg?.content).toBe('');
      expect(assistantMsg?.retryAttempt).toBe(2);
      expect(assistantMsg?.maxRetries).toBe(3);
    });

    it('sets status to streaming and keeps input enabled', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: '' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_STREAM_RETRY',
        messageId: 'assistant-1',
        attempt: 2,
        maxRetries: 3,
      });

      expect(result.chat.status).toBe('streaming');
      expect(result.ui.chatInputEnabled).toBe(true);
      expect(result.chat.error).toBeNull();
    });

    it('returns unchanged state if message not found', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: 'hello' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_STREAM_RETRY',
        messageId: 'nonexistent',
        attempt: 2,
        maxRetries: 3,
      });

      expect(result).toBe(state);
    });

    it('clears annotations from previous failed attempt', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({
          id: 'assistant-1',
          role: 'assistant',
          content: 'partial',
          annotations: [{ type: 'file_citation', label: 'doc.md' }],
        }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_STREAM_RETRY',
        messageId: 'assistant-1',
        attempt: 2,
        maxRetries: 3,
      });

      expect(result.chat.messages[0].annotations).toBeUndefined();
    });
  });

  describe('CHAT_RECOVER_MESSAGE', () => {
    it('removes the last two messages and restores input text', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'old-1', role: 'user', content: 'old message' }),
        createMockMessage({ id: 'old-2', role: 'assistant', content: 'old response' }),
        createMockMessage({ id: 'user-1', role: 'user', content: 'failed message' }),
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: '' }),
      ];
      state.chat.streamingMessageId = 'assistant-1';

      const result = appReducer(state, {
        type: 'CHAT_RECOVER_MESSAGE',
        messageText: 'failed message',
        mode: 'detailed',
        error: { code: 'NETWORK', message: 'Connection failed', recoverable: true },
        retryCount: 3,
      });

      expect(result.chat.messages).toHaveLength(2);
      expect(result.chat.messages[0].id).toBe('old-1');
      expect(result.chat.messages[1].id).toBe('old-2');
      expect(result.chat.recoveredInput).toBe('failed message');
      expect(result.chat.recoveredMode).toBe('detailed');
    });

    it('sets error with retry count message and enables input', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user' }),
        createMockMessage({ id: 'assistant-1', role: 'assistant' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_RECOVER_MESSAGE',
        messageText: 'test',
        mode: 'auto',
        error: { code: 'NETWORK', message: 'Connection failed', recoverable: true },
        retryCount: 3,
      });

      expect(result.chat.status).toBe('error');
      expect(result.chat.error?.message).toContain('3 attempts');
      expect(result.chat.error?.recoverable).toBe(true);
      expect(result.ui.chatInputEnabled).toBe(true);
      expect(result.chat.streamingMessageId).toBeUndefined();
    });

    it('uses singular "attempt" for retryCount of 1', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user' }),
        createMockMessage({ id: 'assistant-1', role: 'assistant' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_RECOVER_MESSAGE',
        messageText: 'test',
        mode: 'auto',
        error: { code: 'AUTH', message: 'Unauthorized', recoverable: false },
        retryCount: 1,
      });

      expect(result.chat.error?.message).toContain('1 attempt');
      expect(result.chat.error?.message).not.toContain('1 attempts');
    });

    it('handles empty message array gracefully', () => {
      const state = createInitialState();
      state.chat.messages = [];

      const result = appReducer(state, {
        type: 'CHAT_RECOVER_MESSAGE',
        messageText: 'orphaned text',
        mode: 'auto',
        error: { code: 'NETWORK', message: 'Failed', recoverable: true },
        retryCount: 3,
      });

      expect(result.chat.messages).toHaveLength(0);
      expect(result.chat.recoveredInput).toBe('orphaned text');
      expect(result.chat.status).toBe('error');
    });

    it('handles single message array gracefully', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'lonely', role: 'user' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_RECOVER_MESSAGE',
        messageText: 'test',
        mode: 'auto',
        error: { code: 'STREAM', message: 'Broke', recoverable: true },
        retryCount: 2,
      });

      expect(result.chat.messages).toHaveLength(0);
      expect(result.chat.recoveredInput).toBe('test');
    });
  });

  describe('CHAT_CONSUMED_RECOVERED_INPUT', () => {
    it('clears recoveredInput', () => {
      const state = createInitialState();
      state.chat.recoveredInput = 'restored text';

      const result = appReducer(state, { type: 'CHAT_CONSUMED_RECOVERED_INPUT' });

      expect(result.chat.recoveredInput).toBeUndefined();
    });

    it('does not change other chat state', () => {
      const state = createInitialState();
      state.chat.recoveredInput = 'restored text';
      state.chat.status = 'error';
      state.chat.error = { code: 'NETWORK', message: 'Failed', recoverable: true };

      const result = appReducer(state, { type: 'CHAT_CONSUMED_RECOVERED_INPUT' });

      expect(result.chat.status).toBe('error');
      expect(result.chat.error).not.toBeNull();
    });
  });

  describe('CHAT_QUEUE_MESSAGE', () => {
    it('appends text to pendingMessages', () => {
      const state = createInitialState();

      const result = appReducer(state, { type: 'CHAT_QUEUE_MESSAGE', text: 'first', mode: 'simple' });

      expect(result.chat.pendingMessages).toEqual([{ text: 'first', files: undefined, mode: 'simple' }]);
    });

    it('appends multiple messages in order', () => {
      const state = createInitialState();
      state.chat.pendingMessages = [{ text: 'first', mode: 'auto' }];

      const result = appReducer(state, { type: 'CHAT_QUEUE_MESSAGE', text: 'second', mode: 'detailed' });

      expect(result.chat.pendingMessages).toEqual([{ text: 'first', mode: 'auto' }, { text: 'second', files: undefined, mode: 'detailed' }]);
    });

    it('preserves the selected mode for each queued message', () => {
      const state = createInitialState();
      state.chat.pendingMessages = [{ text: 'first', mode: 'simple' }];

      const result = appReducer(state, { type: 'CHAT_QUEUE_MESSAGE', text: 'second', mode: 'detailed' });

      expect(result.chat.pendingMessages.map(message => message.mode)).toEqual(['simple', 'detailed']);
    });
  });

  describe('CHAT_DEQUEUE_MESSAGE', () => {
    it('removes message at given index', () => {
      const state = createInitialState();
      state.chat.pendingMessages = [{ text: 'a', mode: 'auto' }, { text: 'b', mode: 'auto' }, { text: 'c', mode: 'auto' }];

      const result = appReducer(state, { type: 'CHAT_DEQUEUE_MESSAGE', index: 1 });

      expect(result.chat.pendingMessages).toEqual([{ text: 'a', mode: 'auto' }, { text: 'c', mode: 'auto' }]);
    });

    it('handles removing last item', () => {
      const state = createInitialState();
      state.chat.pendingMessages = [{ text: 'only', mode: 'auto' }];

      const result = appReducer(state, { type: 'CHAT_DEQUEUE_MESSAGE', index: 0 });

      expect(result.chat.pendingMessages).toEqual([]);
    });
  });

  describe('CHAT_CLEAR_QUEUE', () => {
    it('empties pendingMessages', () => {
      const state = createInitialState();
      state.chat.pendingMessages = [{ text: 'a', mode: 'auto' }, { text: 'b', mode: 'auto' }, { text: 'c', mode: 'auto' }];

      const result = appReducer(state, { type: 'CHAT_CLEAR_QUEUE' });

      expect(result.chat.pendingMessages).toEqual([]);
    });
  });

  describe('CHAT_CLEAR', () => {
    it('clears pendingMessages', () => {
      const state = createInitialState();
      state.chat.pendingMessages = [{ text: 'queued', mode: 'auto' }];

      const result = appReducer(state, { type: 'CHAT_CLEAR' });

      expect(result.chat.pendingMessages).toEqual([]);
    });
  });

  describe('CHAT_LOAD_CONVERSATION', () => {
    it('clears pendingMessages when switching conversations', () => {
      const state = createInitialState();
      state.chat.pendingMessages = [{ text: 'queued', mode: 'auto' }];

      const result = appReducer(state, {
        type: 'CHAT_LOAD_CONVERSATION',
        conversationId: 'new-conv',
        messages: [],
      });

      expect(result.chat.pendingMessages).toEqual([]);
    });
  });

  describe('CHAT_START_STREAM', () => {
    it('keeps input enabled during streaming', () => {
      const state = createInitialState();

      const result = appReducer(state, {
        type: 'CHAT_START_STREAM',
        conversationId: 'conv-1',
        messageId: 'msg-1',
      });

      expect(result.ui.chatInputEnabled).toBe(true);
    });
  });

  describe('CHAT_CLEAR_ERROR', () => {
    it('clears recoveredInput along with error', () => {
      const state = createInitialState();
      state.chat.error = { code: 'NETWORK', message: 'Error', recoverable: true };
      state.chat.recoveredInput = 'leftover text';
      state.chat.status = 'error';

      const result = appReducer(state, { type: 'CHAT_CLEAR_ERROR' });

      expect(result.chat.recoveredInput).toBeUndefined();
      expect(result.chat.error).toBeNull();
      expect(result.chat.status).toBe('idle');
    });
  });

  describe('CHAT_STREAM_COMPLETE', () => {
    it('clears retry metadata on successful completion', () => {
      const state = createInitialState();
      state.chat.streamingMessageId = 'assistant-1';
      state.chat.messages = [
        createMockMessage({
          id: 'assistant-1',
          role: 'assistant',
          content: 'response',
          retryAttempt: 2,
          maxRetries: 3,
        }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_STREAM_COMPLETE',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, duration: 1234 },
      });

      const msg = result.chat.messages[0];
      expect(msg.retryAttempt).toBeUndefined();
      expect(msg.maxRetries).toBeUndefined();
      expect(msg.more?.usage?.totalTokens).toBe(150);
    });
  });

  describe('immutability', () => {
    it('does not mutate original state', () => {
      const state = createInitialState();
      const originalState = JSON.parse(JSON.stringify(state));
      const message = createMockMessage();

      appReducer(state, { type: 'CHAT_SEND_MESSAGE', message });

      expect(state).toEqual(originalState);
    });
  });

  describe('CONVERSATIONS_LOADING', () => {
    it('sets isLoading to true and preserves other conversation state', () => {
      const state = createInitialState();
      state.conversations.sidebarOpen = true;
      state.conversations.list = [{ id: 'c1', title: 'Test', createdAt: 1 }];

      const result = appReducer(state, { type: 'CONVERSATIONS_LOADING' });

      expect(result.conversations.isLoading).toBe(true);
      expect(result.conversations.sidebarOpen).toBe(true);
      expect(result.conversations.list).toHaveLength(1);
    });
  });

  describe('CONVERSATIONS_LOADING_DONE', () => {
    it('sets isLoading to false while preserving conversation data', () => {
      const state = createInitialState();
      state.conversations.isLoading = true;
      state.conversations.sidebarOpen = true;
      state.conversations.list = [{ id: 'c1', title: 'Existing', createdAt: 1 }];
      state.conversations.hasMore = true;

      const result = appReducer(state, { type: 'CONVERSATIONS_LOADING_DONE' });

      expect(result.conversations.isLoading).toBe(false);
      expect(result.conversations.sidebarOpen).toBe(true);
      expect(result.conversations.list).toHaveLength(1);
      expect(result.conversations.hasMore).toBe(true);
    });
  });

  describe('CONVERSATIONS_SET_LIST', () => {
    it('sets list from action.conversations, sets hasMore, sets isLoading to false', () => {
      const state = createInitialState();
      state.conversations.isLoading = true;
      const conversations = [
        { id: 'c1', title: 'Conv 1', createdAt: 1 },
        { id: 'c2', title: 'Conv 2', createdAt: 2 },
      ];

      const result = appReducer(state, {
        type: 'CONVERSATIONS_SET_LIST',
        conversations,
        hasMore: true,
      });

      expect(result.conversations.list).toEqual(conversations);
      expect(result.conversations.hasMore).toBe(true);
      expect(result.conversations.isLoading).toBe(false);
    });

    it('appends to existing list when append is true', () => {
      const state = createInitialState();
      state.conversations.list = [{ id: 'c1', title: 'Existing', createdAt: 1 }];
      const newConversations = [{ id: 'c2', title: 'New', createdAt: 2 }];

      const result = appReducer(state, {
        type: 'CONVERSATIONS_SET_LIST',
        conversations: newConversations,
        hasMore: false,
        append: true,
      });

      expect(result.conversations.list).toHaveLength(2);
      expect(result.conversations.list[0].id).toBe('c1');
      expect(result.conversations.list[1].id).toBe('c2');
    });

    it('sets hasMore to false when indicated', () => {
      const state = createInitialState();
      state.conversations.hasMore = true;

      const result = appReducer(state, {
        type: 'CONVERSATIONS_SET_LIST',
        conversations: [],
        hasMore: false,
      });

      expect(result.conversations.hasMore).toBe(false);
    });
  });

  describe('CONVERSATIONS_TOGGLE_SIDEBAR', () => {
    it('toggles sidebarOpen from false to true', () => {
      const state = createInitialState();
      state.conversations.sidebarOpen = false;

      const result = appReducer(state, { type: 'CONVERSATIONS_TOGGLE_SIDEBAR' });

      expect(result.conversations.sidebarOpen).toBe(true);
    });

    it('toggles sidebarOpen from true to false', () => {
      const state = createInitialState();
      state.conversations.sidebarOpen = true;

      const result = appReducer(state, { type: 'CONVERSATIONS_TOGGLE_SIDEBAR' });

      expect(result.conversations.sidebarOpen).toBe(false);
    });
  });

  describe('CONVERSATIONS_REMOVE', () => {
    it('removes conversation by ID from list', () => {
      const state = createInitialState();
      state.conversations.list = [
        { id: 'c1', title: 'Conv 1', createdAt: 1 },
        { id: 'c2', title: 'Conv 2', createdAt: 2 },
        { id: 'c3', title: 'Conv 3', createdAt: 3 },
      ];

      const result = appReducer(state, { type: 'CONVERSATIONS_REMOVE', conversationId: 'c2' });

      expect(result.conversations.list).toHaveLength(2);
      expect(result.conversations.list.find(c => c.id === 'c2')).toBeUndefined();
    });

    it('preserves other conversations', () => {
      const state = createInitialState();
      state.conversations.list = [
        { id: 'c1', title: 'Conv 1', createdAt: 1 },
        { id: 'c2', title: 'Conv 2', createdAt: 2 },
      ];

      const result = appReducer(state, { type: 'CONVERSATIONS_REMOVE', conversationId: 'c1' });

      expect(result.conversations.list).toHaveLength(1);
      expect(result.conversations.list[0].id).toBe('c2');
    });
  });

  describe('CHAT_STREAM_TOOL_USE', () => {
    it('sets activeToolUse on the streaming message', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: 'Thinking...' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_STREAM_TOOL_USE',
        messageId: 'assistant-1',
        toolName: 'file_search',
      });

      expect(result.chat.messages[0].activeToolUse).toBe('file_search');
    });

    it('updates activeToolUse when tool changes', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'assistant-1', role: 'assistant', activeToolUse: 'file_search' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_STREAM_TOOL_USE',
        messageId: 'assistant-1',
        toolName: 'code_interpreter',
      });

      expect(result.chat.messages[0].activeToolUse).toBe('code_interpreter');
    });

    it('returns unchanged state if message not found', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'assistant-1', role: 'assistant' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_STREAM_TOOL_USE',
        messageId: 'nonexistent',
        toolName: 'file_search',
      });

      expect(result).toBe(state);
    });

    it('does not affect other messages', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user', content: 'Hello' }),
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: '' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_STREAM_TOOL_USE',
        messageId: 'assistant-1',
        toolName: 'file_search',
      });

      expect(result.chat.messages[0].activeToolUse).toBeUndefined();
      expect(result.chat.messages[1].activeToolUse).toBe('file_search');
    });
  });

  describe('CHAT_STREAM_COMPLETE', () => {
    it('clears activeToolUse on the completed message', () => {
      const state = createInitialState();
      state.chat.streamingMessageId = 'assistant-1';
      state.chat.messages = [
        createMockMessage({
          id: 'assistant-1',
          role: 'assistant',
          content: 'done',
          activeToolUse: 'file_search',
        }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_STREAM_COMPLETE',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, duration: 500 },
      });

      expect(result.chat.messages[0].activeToolUse).toBeUndefined();
    });
  });

  describe('CHAT_REGENERATE', () => {
    it('removes last assistant and its preceding user message, stores user text as regenerateText', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user', content: 'What is AI?' }),
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: 'AI is...' }),
      ];

      const result = appReducer(state, { type: 'CHAT_REGENERATE' });

      expect(result.chat.messages).toHaveLength(0);
      expect(result.chat.regenerateText).toBe('What is AI?');
    });

    it('sets status to idle and enables input', () => {
      const state = createInitialState();
      state.chat.status = 'streaming';
      state.ui.chatInputEnabled = false;
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user', content: 'Hello' }),
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: 'Hi' }),
      ];

      const result = appReducer(state, { type: 'CHAT_REGENERATE' });

      expect(result.chat.status).toBe('idle');
      expect(result.ui.chatInputEnabled).toBe(true);
      expect(result.chat.streamingMessageId).toBeUndefined();
      expect(result.chat.messages).toHaveLength(0);
    });

    it('returns unchanged state if no messages', () => {
      const state = createInitialState();
      state.chat.messages = [];

      const result = appReducer(state, { type: 'CHAT_REGENERATE' });

      expect(result).toBe(state);
    });

    it('returns unchanged state if last message is not assistant', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user', content: 'Hello' }),
      ];

      const result = appReducer(state, { type: 'CHAT_REGENERATE' });

      expect(result).toBe(state);
    });

    it('handles multi-turn conversation correctly', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user', content: 'First question' }),
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: 'First answer' }),
        createMockMessage({ id: 'user-2', role: 'user', content: 'Follow up' }),
        createMockMessage({ id: 'assistant-2', role: 'assistant', content: 'Second answer' }),
      ];

      const result = appReducer(state, { type: 'CHAT_REGENERATE' });

      expect(result.chat.messages).toHaveLength(2);
      expect(result.chat.messages[0].id).toBe('user-1');
      expect(result.chat.messages[1].id).toBe('assistant-1');
      expect(result.chat.regenerateText).toBe('Follow up');
    });
  });

  describe('CHAT_EDIT_MESSAGE', () => {
    it('removes target message and everything after, stores newText as recoveredInput', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user', content: 'Original' }),
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: 'Response' }),
        createMockMessage({ id: 'user-2', role: 'user', content: 'Follow up' }),
        createMockMessage({ id: 'assistant-2', role: 'assistant', content: 'Second response' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_EDIT_MESSAGE',
        messageId: 'user-2',
        newText: 'Edited follow up',
      });

      expect(result.chat.messages).toHaveLength(2);
      expect(result.chat.messages[0].id).toBe('user-1');
      expect(result.chat.messages[1].id).toBe('assistant-1');
      expect(result.chat.recoveredInput).toBe('Edited follow up');
    });

    it('sets status to idle and enables input', () => {
      const state = createInitialState();
      state.chat.status = 'streaming';
      state.ui.chatInputEnabled = false;
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user', content: 'Hello' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_EDIT_MESSAGE',
        messageId: 'user-1',
        newText: 'Edited',
      });

      expect(result.chat.status).toBe('idle');
      expect(result.ui.chatInputEnabled).toBe(true);
      expect(result.chat.streamingMessageId).toBeUndefined();
    });

    it('returns unchanged state if messageId not found', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user', content: 'Hello' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_EDIT_MESSAGE',
        messageId: 'nonexistent',
        newText: 'New text',
      });

      expect(result).toBe(state);
    });

    it('removes all messages when editing the first one', () => {
      const state = createInitialState();
      state.chat.messages = [
        createMockMessage({ id: 'user-1', role: 'user', content: 'First' }),
        createMockMessage({ id: 'assistant-1', role: 'assistant', content: 'Reply' }),
      ];

      const result = appReducer(state, {
        type: 'CHAT_EDIT_MESSAGE',
        messageId: 'user-1',
        newText: 'Revised first',
      });

      expect(result.chat.messages).toHaveLength(0);
      expect(result.chat.recoveredInput).toBe('Revised first');
    });
  });

  describe('CHAT_CONSUMED_REGENERATE', () => {
    it('clears regenerateText', () => {
      const state = createInitialState();
      state.chat.regenerateText = 'pending text';

      const result = appReducer(state, { type: 'CHAT_CONSUMED_REGENERATE' });

      expect(result.chat.regenerateText).toBeUndefined();
    });

    it('does not change other chat state', () => {
      const state = createInitialState();
      state.chat.regenerateText = 'pending text';
      state.chat.status = 'idle';
      state.chat.messages = [createMockMessage({ id: 'user-1', role: 'user' })];

      const result = appReducer(state, { type: 'CHAT_CONSUMED_REGENERATE' });

      expect(result.chat.status).toBe('idle');
      expect(result.chat.messages).toHaveLength(1);
    });
  });

  describe('state shape', () => {
    it('snapshot drifts when state fields are added or removed', () => {
      const getShape = (obj: Record<string, unknown>, prefix = ''): string[] => {
        return Object.keys(obj).sort().flatMap(key => {
          const path = prefix ? `${prefix}.${key}` : key;
          const value = obj[key];
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            return [path, ...getShape(value as Record<string, unknown>, path)];
          }
          return [path];
        });
      };

      const shape = getShape(initialAppState as unknown as Record<string, unknown>);
      expect(shape).toMatchInlineSnapshot(`
        [
          "auth",
          "auth.error",
          "auth.status",
          "auth.user",
          "chat",
          "chat.currentConversationId",
          "chat.editSnapshot",
          "chat.error",
          "chat.messages",
          "chat.pendingMessages",
          "chat.recoveredAttachments",
          "chat.recoveredInput",
          "chat.recoveredMode",
          "chat.regenerateText",
          "chat.status",
          "chat.streamingMessageId",
          "conversations",
          "conversations.hasMore",
          "conversations.isLoading",
          "conversations.list",
          "conversations.sidebarOpen",
          "ui",
          "ui.chatInputEnabled",
        ]
      `);
    });
  });
});

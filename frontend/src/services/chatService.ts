import type { Dispatch } from 'react';
import type { AppAction } from '../types/appState';
import type { ConversationSummary, ConversationMessageInfo } from '../types/appState';
import type { IChatItem } from '../types/chat';
import type { AppError } from '../types/errors';
import { isAppError } from '../types/errors';
import { trackException } from './telemetry';
import {
  createAppError,
  getErrorCodeFromMessage,
  parseErrorFromResponse,
  getErrorCodeFromResponse,
  isTokenExpiredError,
  retryWithBackoff,
} from '../utils/errorHandler';
import {
  convertFilesToDataUris,
  createAttachmentMetadata,
} from '../utils/fileAttachments';
import { parseSseLine, splitSseBuffer } from '../utils/sseParser';

/**
 * ChatService handles all chat-related API operations.
 * Dispatches AppContext actions for state management.
 * 
 * @example
 * ```typescript
 * const chatService = new ChatService(
 *   '/api',
 *   getAccessToken,
 *   dispatch
 * );
 * 
 * // Send a message with images
 * await chatService.sendMessage(
 *   'Analyze this image',
 *   currentThreadId,
 *   [imageFile]
 * );
 * ```
 */
export class ChatService {
  private apiUrl: string;
  private getAccessToken: () => Promise<string | null>;
  private dispatch: Dispatch<AppAction>;
  private currentStreamAbort?: AbortController;
  // Flag indicating an intentional user cancellation of the active stream.
  private streamCancelled = false;

  constructor(
    apiUrl: string,
    getAccessToken: () => Promise<string | null>,
    dispatch: Dispatch<AppAction>
  ) {
    this.apiUrl = apiUrl;
    this.getAccessToken = getAccessToken;
    this.dispatch = dispatch;
  }

  /**
   * Acquire authentication token using MSAL.
   * Attempts silent acquisition first, falls back to popup if needed.
   * 
   * @returns Access token string
   * @throws {Error} If token acquisition fails
   */
  private async ensureAuthToken(): Promise<string> {
    const token = await this.getAccessToken();
    if (!token) {
      throw createAppError(new Error('Failed to acquire access token'), 'AUTH');
    }
    return token;
  }

  /**
   * Prepare message payload with optional file attachments.
   * Converts files to data URIs and separates images from documents.
   * 
   * @param text - Message text content
   * @param files - Optional array of files (images and documents)
   * @returns Payload with content, image URIs, file attachments, and attachment metadata
   */
  private async prepareMessagePayload(
    text: string,
    files?: File[]
  ): Promise<{
    content: string;
    imageDataUris: string[];
    fileDataUris: Array<{ dataUri: string; fileName: string; mimeType: string }>;
    attachments: IChatItem['attachments'];
  }> {
    let imageDataUris: string[] = [];
    let fileDataUris: Array<{ dataUri: string; fileName: string; mimeType: string }> = [];
    let attachments: IChatItem['attachments'] = undefined;

    if (files && files.length > 0) {
      try {
        const results = await convertFilesToDataUris(files);
        
        // Separate images from documents
        const imageResults = results.filter((r) => r.mimeType.startsWith('image/'));
        const fileResults = results.filter((r) => !r.mimeType.startsWith('image/'));
        
        imageDataUris = imageResults.map((r) => r.dataUri);
        fileDataUris = fileResults.map((r) => ({
          dataUri: r.dataUri,
          fileName: r.name,
          mimeType: r.mimeType,
        }));
        
        // Create attachment metadata for UI display
        attachments = createAttachmentMetadata(results);
      } catch (error) {
        const appError = createAppError(error);
        this.dispatch({ type: 'CHAT_ERROR', error: appError });
        throw appError;
      }
    }

    return { content: text, imageDataUris, fileDataUris, attachments };
  }

  /**
   * Construct request body for chat API.
   * 
   * @param message - User message text
   * @param conversationId - Current conversation ID (null for new conversations)
   * @param imageDataUris - Array of base64 data URIs for images
   * @param fileDataUris - Array of file attachments with metadata
   * @returns Request body object
   */
  private constructRequestBody(
    message: string,
    conversationId: string | null,
    imageDataUris: string[],
    fileDataUris: Array<{ dataUri: string; fileName: string; mimeType: string }>
  ): Record<string, unknown> {
    return {
      message,
      conversationId,
      imageDataUris: imageDataUris.length > 0 ? imageDataUris : undefined,
      fileDataUris: fileDataUris.length > 0 ? fileDataUris : undefined,
    };
  }

  /**
   * Initiate streaming fetch request to chat API.
   * Validates response and throws typed errors on failure.
   * 
   * @param url - API endpoint URL
   * @param token - Access token
   * @param body - Request body
   * @param signal - Abort signal for cancellation
   * @returns Response object
   * @throws {AppError} If request fails or response is not OK
   */
  private async initiateStream(
    url: string,
    token: string,
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Response> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errorMessage = await parseErrorFromResponse(res);
      const errorCode = getErrorCodeFromResponse(res);
      throw createAppError(new Error(errorMessage), errorCode);
    }

    return res;
  }

  /**
   * Send a message and stream the response from the Azure AI Agent.
   * Orchestrates authentication, file conversion, optimistic UI updates, and streaming.
   * Retries the full stream cycle up to 3 times on retryable errors, then recovers
   * the message text back to the input if all retries fail.
   *
   * @param messageText - The user's message text
   * @param currentConversationId - Current conversation ID (null for new conversations)
   * @param files - Optional array of files to attach (images and documents)
   * @throws {Error} If authentication fails (non-retryable)
   */
  async sendMessage(
    messageText: string,
    currentConversationId: string | null,
    files?: File[]
  ): Promise<void> {
    if (this.currentStreamAbort) {
      this.streamCancelled = true;
      this.currentStreamAbort.abort();
      this.dispatch({ type: 'CHAT_CANCEL_STREAM' });
    }

    let token: string;
    try {
      token = await this.ensureAuthToken();
    } catch (error) {
      if (isTokenExpiredError(error)) {
        this.dispatch({ type: 'AUTH_TOKEN_EXPIRED' });
      }
      const appError: AppError = isAppError(error)
        ? error
        : createAppError(error, 'AUTH');
      this.dispatch({ type: 'CHAT_ERROR', error: appError });
      throw error;
    }

    const { content, imageDataUris, fileDataUris, attachments } = await this.prepareMessagePayload(
      messageText,
      files
    );

    const userMessage: IChatItem = {
      id: Date.now().toString(),
      role: 'user',
      content,
      attachments,
      more: {
        time: new Date().toISOString(),
      },
    };

    this.dispatch({ type: 'CHAT_SEND_MESSAGE', message: userMessage });

    const assistantMessageId = (Date.now() + 1).toString();
    this.dispatch({ type: 'CHAT_ADD_ASSISTANT_MESSAGE', messageId: assistantMessageId });
    this.dispatch({
      type: 'CHAT_START_STREAM',
      conversationId: currentConversationId || undefined,
      messageId: assistantMessageId,
    });

    const requestBody = this.constructRequestBody(
      messageText,
      currentConversationId,
      imageDataUris,
      fileDataUris
    );

    const maxRetries = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          this.dispatch({
            type: 'CHAT_STREAM_RETRY',
            messageId: assistantMessageId,
            attempt,
            maxRetries,
          });
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
        }

        this.currentStreamAbort = new AbortController();
        this.streamCancelled = false;

        const response = await this.initiateStream(
          `${this.apiUrl}/chat/stream`,
          token,
          requestBody,
          this.currentStreamAbort.signal
        );

        await this.processStream(response, assistantMessageId, currentConversationId);
        this.currentStreamAbort = undefined;
        this.streamCancelled = false;
        return;
      } catch (error) {
        lastError = error;
        this.currentStreamAbort = undefined;
        this.streamCancelled = false;

        // User cancelled
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (isTokenExpiredError(error)) {
          this.dispatch({ type: 'AUTH_TOKEN_EXPIRED' });
          throw error;
        }

        if (isAppError(error) && error.code === 'AUTH') {
          this.dispatch({ type: 'CHAT_ERROR', error });
          throw error;
        }

        if (attempt === maxRetries) {
          break;
        }
      }
    }

    trackException(lastError instanceof Error ? lastError : new Error(String(lastError)), {
      context: 'sendMessage',
      retryCount: String(maxRetries),
    });

    const appError: AppError = isAppError(lastError)
      ? lastError
      : createAppError(lastError, getErrorCodeFromMessage(lastError));

    this.dispatch({
      type: 'CHAT_RECOVER_MESSAGE',
      messageText,
      error: appError,
      retryCount: maxRetries,
    });
  }

  /**
   * Process Server-Sent Events stream from the API.
   * Implements duplicate chunk suppression to prevent UI flicker.
   * 
   * @param response - Fetch Response object with SSE stream
   * @param messageId - ID of the assistant message being streamed
   * @param currentConversationId - Current conversation ID (null for new conversations)
   * @throws {Error} If stream is not readable or parsing fails
   */
  private async processStream(
    response: Response,
    messageId: string,
    currentConversationId: string | null
  ): Promise<void> {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      const error = createAppError(
        new Error(`Response body is not readable for message ${messageId}`),
        'STREAM'
      );
      this.dispatch({ type: 'CHAT_ERROR', error });
      throw error;
    }

    let newConversationId = currentConversationId;
    let lastChunkContent: string | undefined;
    let buffer = '';

    try {
      while (true) {
        if (this.streamCancelled) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const [lines, remaining] = splitSseBuffer(buffer);
        buffer = remaining;

        for (const line of lines) {
          const event = parseSseLine(line);
          if (!event) continue;

          if (event.data?.error) {
            console.error('[ChatService] SSE error event received:', event.data.error);
            const error = createAppError(
              new Error(event.data.error.message || event.data.error || 'Stream error occurred'),
              'STREAM'
            );
            this.dispatch({ type: 'CHAT_ERROR', error });
            throw error;
          }

          switch (event.type) {
            case 'conversationId':
              if (!newConversationId) {
                newConversationId = event.data.conversationId;
                this.dispatch({
                  type: 'CHAT_START_STREAM',
                  conversationId: event.data.conversationId,
                  messageId,
                });
              }
              break;

            case 'chunk':
              if (event.data.content !== lastChunkContent) {
                this.dispatch({
                  type: 'CHAT_STREAM_CHUNK',
                  messageId,
                  content: event.data.content,
                });
                lastChunkContent = event.data.content;
              }
              break;

            case 'annotations':
              if (event.data.annotations && event.data.annotations.length > 0) {
                this.dispatch({
                  type: 'CHAT_STREAM_ANNOTATIONS',
                  messageId,
                  annotations: event.data.annotations,
                });
              }
              break;

            case 'toolUse':
              if (event.data.toolName) {
                this.dispatch({
                  type: 'CHAT_STREAM_TOOL_USE',
                  messageId,
                  toolName: event.data.toolName,
                });
              }
              break;

            case 'mcpApprovalRequest':
              if (event.data.approvalRequest) {
                this.dispatch({
                  type: 'CHAT_MCP_APPROVAL_REQUEST',
                  messageId,
                  approvalRequest: event.data.approvalRequest,
                  previousResponseId: event.data.approvalRequest.previousResponseId ?? '',
                });
              }
              break;

            case 'usage':
              this.dispatch({
                type: 'CHAT_STREAM_COMPLETE',
                usage: {
                  promptTokens: event.data.promptTokens,
                  completionTokens: event.data.completionTokens,
                  totalTokens: event.data.totalTokens,
                  duration: event.data.duration,
                },
              });
              break;

            case 'done':
              return;

            case 'error': {
              const error = createAppError(
                new Error(`Stream error for message ${messageId}: ${event.data.message}`),
                'STREAM'
              );
              this.dispatch({ type: 'CHAT_ERROR', error });
              throw error;
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError' && this.streamCancelled) {
        // User intentionally cancelled the stream - not an error condition
        return;
      }

      const appError =
        error instanceof Error && 'code' in error
          ? error
          : createAppError(
              new Error(
                `Stream processing failed: ${error instanceof Error ? error.message : String(error)} (Conversation: ${currentConversationId}, Message: ${messageId})`
              ),
              'STREAM'
            );
      this.dispatch({ type: 'CHAT_ERROR', error: appError as AppError });
      throw error;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Reader may already be released
      }
    }
  }

  /**
   * Send approval response for an MCP tool call.
   * 
   * @param approvalRequestId - ID of the approval request
   * @param approved - Whether the tool call was approved
   * @param previousResponseId - Response ID to continue from
   * @param conversationId - Current conversation ID
   */
  async sendMcpApproval(
    approvalRequestId: string,
    approved: boolean,
    previousResponseId: string,
    conversationId: string
  ): Promise<void> {
    try {
      const token = await this.ensureAuthToken();

      const assistantMessageId = Date.now().toString();
      this.dispatch({ type: 'CHAT_ADD_ASSISTANT_MESSAGE', messageId: assistantMessageId });
      this.dispatch({
        type: 'CHAT_START_STREAM',
        conversationId,
        messageId: assistantMessageId,
      });

      this.currentStreamAbort = new AbortController();
      this.streamCancelled = false;

      const requestBody = {
        message: approved ? 'Approved' : 'Rejected',
        conversationId,
        previousResponseId,
        mcpApproval: {
          approvalRequestId,
          approved,
        },
      };

      const response = await retryWithBackoff(
        async () =>
          this.initiateStream(
            `${this.apiUrl}/chat/stream`,
            token,
            requestBody,
            this.currentStreamAbort!.signal
          ),
        3,
        1000
      );

      await this.processStream(response, assistantMessageId, conversationId);
      this.currentStreamAbort = undefined;
      this.streamCancelled = false;
    } catch (error) {
      this.currentStreamAbort = undefined;
      this.streamCancelled = false;

      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      trackException(error instanceof Error ? error : new Error(String(error)), { context: 'sendMcpApproval' });

      const appError: AppError = isAppError(error)
        ? error
        : createAppError(error, getErrorCodeFromMessage(error));

      this.dispatch({ type: 'CHAT_ERROR', error: appError });
      throw error;
    }
  }

  /**
   * Clear chat history and reset to empty state.
   * Dispatches CHAT_CLEAR action to remove all messages and conversation ID.
   */
  clearChat(): void {
    this.dispatch({ type: 'CHAT_CLEAR' });
  }

  /**
   * Clear current error state without affecting chat history.
   * Dispatches CHAT_CLEAR_ERROR action.
   */
  clearError(): void {
    this.dispatch({ type: 'CHAT_CLEAR_ERROR' });
  }

  /**
   * Cancel the current streaming response if any is active.
   * Abort controller is not cleared immediately to allow processStream
   * to observe the cancellation flag and exit gracefully.
   */
  cancelStream(): void {
    if (this.currentStreamAbort) {
      this.streamCancelled = true;
      this.currentStreamAbort.abort();
      this.dispatch({ type: 'CHAT_CANCEL_STREAM' });
    }
  }

  async downloadFile(fileId: string, fileName?: string, containerId?: string): Promise<void> {
    const token = await this.ensureAuthToken();
    const params = containerId ? `?containerId=${encodeURIComponent(containerId)}` : '';
    const response = await fetch(`${this.apiUrl}/files/${encodeURIComponent(fileId)}${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`File download failed: ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || fileId;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  /**
   * List all conversations from the server.
   * @returns Array of conversation summaries
   */
  async listConversations(limit: number = 20): Promise<{ conversations: ConversationSummary[]; hasMore: boolean }> {
    const token = await this.ensureAuthToken();
    const response = await fetch(`${this.apiUrl}/conversations?limit=${limit}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw createAppError(new Error(`Failed to list conversations: ${response.status}`), 'API');
    }

    return response.json();
  }

  /**
   * Get messages for a specific conversation.
   * @param conversationId - The conversation ID to fetch messages for
   * @returns Array of conversation messages
   */
  async getConversationMessages(conversationId: string): Promise<ConversationMessageInfo[]> {
    const token = await this.ensureAuthToken();
    const response = await fetch(`${this.apiUrl}/conversations/${conversationId}/messages`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw createAppError(new Error(`Failed to get conversation messages: ${response.status}`), 'API');
    }

    return response.json();
  }

  /**
   * Delete a conversation.
   * @param conversationId - The conversation ID to delete
   */
  async deleteConversation(conversationId: string): Promise<void> {
    const token = await this.ensureAuthToken();
    const response = await fetch(`${this.apiUrl}/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw createAppError(new Error(`Failed to delete conversation: ${response.status}`), 'API');
    }
  }

  /**
   * Get a summary of files uploaded by this web app that are still stored in the Foundry project.
   * Scoped to files whose names begin with the web-app upload prefix (see backend).
   */
  async getUploadedFilesInfo(): Promise<{ count: number; totalBytes: number }> {
    const token = await this.ensureAuthToken();
    const response = await fetch(`${this.apiUrl}/files/uploaded`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw createAppError(new Error(`Failed to list uploaded files: ${response.status}`), 'API');
    }
    return response.json();
  }

  /**
   * Delete every uploaded file that this web app previously uploaded for image attachments.
   */
  async cleanupUploadedFiles(): Promise<{ deleted: number; failed: number }> {
    const token = await this.ensureAuthToken();
    const response = await fetch(`${this.apiUrl}/files/cleanup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw createAppError(new Error(`Failed to clean up uploaded files: ${response.status}`), 'API');
    }
    return response.json();
  }
}

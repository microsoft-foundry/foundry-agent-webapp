/**
 * SSE event types from Azure AI Agent streaming API.
 * Contract: Backend sends Server-Sent Events with these event types.
 */
export type SseEventType = 'conversationId' | 'chunk' | 'annotations' | 'mcpApprovalRequest' | 'usage' | 'done' | 'error';

export interface SseEvent {
  type: SseEventType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface SseConversationIdEvent extends SseEvent {
  type: 'conversationId';
  data: {
    conversationId: string;
  };
}

export interface SseChunkEvent extends SseEvent {
  type: 'chunk';
  data: {
    content: string;
  };
}

export interface SseAnnotationsEvent extends SseEvent {
  type: 'annotations';
  data: {
    annotations: Array<{
      type: string;
      label: string;
      url?: string;
      fileId?: string;
      textToReplace?: string;
      startIndex?: number;
      endIndex?: number;
      quote?: string;
    }>;
  };
}

export interface SseUsageEvent extends SseEvent {
  type: 'usage';
  data: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    duration: number;
  };
}

export interface SseDoneEvent extends SseEvent {
  type: 'done';
  data: Record<string, never>;
}

export interface SseErrorEvent extends SseEvent {
  type: 'error';
  data: {
    message: string;
  };
}

/**
 * Parse a single SSE line into a structured event object.
 * Handles "data: {...}" format from Server-Sent Events protocol.
 * 
 * @param line - Raw SSE line from stream
 * @returns Parsed event object or null if line is invalid
 */
export function parseSseLine(line: string): SseEvent | null {
  const trimmedLine = line.trim();
  
  if (!trimmedLine || !trimmedLine.startsWith('data: ')) {
    return null;
  }

  const jsonString = trimmedLine.substring(6).trim();
  if (!jsonString) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonString);
    
    // Validate event structure
    if (!parsed || typeof parsed !== 'object' || !parsed.type) {
      console.warn('[sseParser] Invalid SSE event structure:', parsed);
      return null;
    }

    // Backend sends flat structure: {type: "conversationId", conversationId: "xyz"}
    // Map to expected structure: {type: "conversationId", data: parsed}
    const { type, ...data } = parsed;
    return { type, data } as SseEvent;
  } catch (error) {
    console.warn('[sseParser] Malformed JSON in SSE event:', jsonString, error);
    return null;
  }
}

/**
 * Split buffer into lines using robust regex pattern.
 * Preserves incomplete last line in buffer for next iteration.
 * 
 * @param buffer - Accumulated text buffer from stream
 * @returns Tuple of [complete lines, remaining buffer]
 */
export function splitSseBuffer(buffer: string): [string[], string] {
  const lines = buffer.split(/\r?\n/);
  const remaining = lines.pop() || '';
  return [lines, remaining];
}

# Architecture Flow

State transitions and data flow diagrams for the foundry-agent-webapp application.

## Overview

The app has two distinct state domains:

| Domain | Location | Pattern |
|--------|----------|---------|
| **Frontend** | React (AppContext) | useReducer with discriminated actions |
| **Backend** | ASP.NET Core | Stateless request handling + lazy-cached agent |

---

## Part 1: Backend Flow

### 1.1 Request Pipeline

```mermaid
flowchart TB
    subgraph Middleware["ASP.NET Core Pipeline"]
        direction TB
        A[Incoming Request] --> B{Static File?}
        B -->|Yes| C[UseStaticFiles]
        B -->|No| D[UseCors]
        D --> E[UseAuthentication]
        E --> F[UseAuthorization]
        F --> G{Has Valid JWT?}
        G -->|No| H[401 Unauthorized]
        G -->|Yes| I{Has Chat.ReadWrite Scope?}
        I -->|No| J[403 Forbidden]
        I -->|Yes| K[Route Handler]
    end

    K --> L{Which Endpoint?}
    L -->|/api/chat/stream| M[StreamChatMessage]
    L -->|/api/agent| N[GetAgentMetadata]
    L -->|/api/agent/info| Q[GetAgentInfo]
    L -->|/api/health| O[GetHealth]
    L -->|/api/conversations| R[ListConversations]
    L -->|/api/conversations/*/messages| S[GetConversationMessages]
    L -->|DELETE /api/conversations/*| T[DeleteConversation ⚠️ 501]
    L -->|/api/files/*| U[DownloadFile]
    L -->|/*| P[Fallback: index.html]
```

### 1.2 Credential Resolution

```mermaid
stateDiagram-v2
    [*] --> CheckEnvironment

    CheckEnvironment --> Development: ASPNETCORE_ENVIRONMENT = Development
    CheckEnvironment --> Production: Otherwise

    state Development {
        [*] --> ChainedCredential
        ChainedCredential --> TryAzureCli: First
        TryAzureCli --> TryAzdCli: Fallback
        TryAzdCli --> CredentialReady: Success
        TryAzdCli --> CredentialFailed: Both failed
    }

    state Production {
        [*] --> CheckOBO
        CheckOBO --> OBOMode: ENTRA_BACKEND_CLIENT_ID AND TenantId set
        CheckOBO --> MIOnly: Not set

        state OBOMode {
            [*] --> ExtractJWT: Per-request
            ExtractJWT --> GetFICAssertion: JWT found
            ExtractJWT --> Error: No JWT (throws InvalidOperationException)
            GetFICAssertion --> CreateOBO: ManagedIdentityClientAssertion
            CreateOBO --> CredentialReady: OnBehalfOfCredential
        }

        note right of OBOMode
            FIC created in postprovision.ps1 (not Bicep)
            — Graph API eventual consistency prevents
            creating FIC in same deployment as parent app.
            User-assigned MI provides client assertion via FIC.
        end note

        MIOnly --> CredentialReady: User-assigned MI
    }

    CredentialReady --> CreateProjectClient
    CredentialFailed --> StartupError
```

### 1.3 Agent Loading (Lazy Singleton)

```mermaid
stateDiagram-v2
    [*] --> NotLoaded: Service instantiated

    NotLoaded --> Loading: First request calls GetAgentAsync
    Loading --> Loading: SemaphoreSlim acquired

    Loading --> Loaded: GetAgentVersionAsync (pinned via AI_AGENT_VERSION) or GetAgentVersionsAsync (latest, first of descending list)
    Loading --> Failed: Exception thrown

    Loaded --> Loaded: Subsequent requests use s_cachedAgentVersion
    Failed --> Loading: Next request retries

    note right of Loaded
        s_cachedAgentVersion: ProjectsAgentVersion (static)
        s_cachedMetadata: AgentMetadataResponse (static)
        Cached across requests (not per-instance)
    end note
```

### 1.4 SSE Streaming Pipeline

```mermaid
sequenceDiagram
    participant Client
    participant Handler as /api/chat/stream
    participant Service as AgentFrameworkService
    participant SDK as Azure.AI.Projects SDK
    participant Agent as AI Foundry

    Client->>Handler: POST ChatRequest
    Handler->>Handler: Set SSE headers

    alt New conversation
        Handler->>Service: CreateConversationAsync
        Service->>SDK: CreateProjectConversationAsync
        SDK-->>Service: conversation.Id
    end

    Handler-->>Client: data: {type: conversationId}

    Handler->>Service: StreamMessageAsync
    Note over Service,SDK: ResponsesClient bound to conversationId —<br/>conversation tracks MCP approval state
    Service->>SDK: CreateResponseStreamingAsync

    loop StreamingResponseUpdate
        SDK-->>Service: update

        alt TextDeltaUpdate
            Service-->>Handler: StreamChunk.Text
            Handler-->>Client: data: {type: chunk}
        else ItemDoneUpdate (MessageItem)
            Service->>Service: ExtractAnnotations
            Service-->>Handler: StreamChunk.WithAnnotations
            Handler-->>Client: data: {type: annotations}
        else ItemDoneUpdate (McpApprovalItem)
            Service-->>Handler: StreamChunk.McpApproval
            Handler-->>Client: data: {type: mcpApprovalRequest}
            Note over Client: Stream pauses for user decision
        else CompletedUpdate
            Service->>Service: Store _lastUsage
        else ErrorUpdate
            Service-->>Handler: throw Exception
        end
    end

    Handler->>Service: GetLastUsage
    Handler-->>Client: data: {type: usage}
    Handler-->>Client: data: {type: done}
```

### 1.5 Backend SSE Event Types

| Event Type | When Sent | Payload |
|------------|-----------|---------|
| `conversationId` | First, always | `{conversationId: string}` |
| `chunk` | Per text delta | `{content: string}` |
| `annotations` | After item complete | `{annotations: AnnotationInfo[]}` — each annotation may include `containerId` for container file citations |
| `mcpApprovalRequest` | MCP tool needs approval | `{approvalRequest: {...}}` |
| `toolUse` | When agent starts using a tool | `{toolName: string}` |
| `usage` | Before done | `{duration, promptTokens, completionTokens, totalTokens}` |
| `done` | Last, always | `{}` |
| `error` | On exception | `{message: string}` |

---

## Part 2: Frontend State

The frontend manages three state domains:
- **Auth State**: User authentication lifecycle
- **Chat State**: Message and streaming lifecycle  
- **UI State**: Input enablement (derived from chat state)

### 2.1 Authentication State Machine

```mermaid
stateDiagram-v2
    [*] --> initializing

    initializing --> authenticated: AUTH_INITIALIZED
    initializing --> unauthenticated: No cached session

    authenticated --> unauthenticated: AUTH_TOKEN_EXPIRED
    unauthenticated --> authenticated: AUTH_INITIALIZED

    authenticated --> error: Token acquisition fails
    error --> unauthenticated: User dismisses
```

### Auth States

| State | Description | User Object |
|-------|-------------|-------------|
| `initializing` | App startup, checking MSAL cache | `null` |
| `authenticated` | Valid session, user info available | `AccountInfo` |
| `unauthenticated` | No session, login required | `null` |
| `error` | Auth failure (rare) | `null` |

---

### 2.2 Chat State Machine

```mermaid
stateDiagram-v2
    [*] --> idle

    idle --> sending: CHAT_SEND_MESSAGE
    
    sending --> streaming: CHAT_START_STREAM
    sending --> error: CHAT_ERROR

    streaming --> streaming: CHAT_STREAM_CHUNK
    streaming --> streaming: CHAT_STREAM_ANNOTATIONS
    streaming --> streaming: CHAT_STREAM_RETRY
    streaming --> streaming: CHAT_STREAM_TOOL_USE
    streaming --> idle: CHAT_STREAM_COMPLETE
    streaming --> idle: CHAT_CANCEL_STREAM
    streaming --> idle: CHAT_MCP_APPROVAL_REQUEST
    streaming --> error: CHAT_ERROR
    streaming --> error: CHAT_RECOVER_MESSAGE

    error --> idle: CHAT_CLEAR_ERROR

    idle --> idle: CHAT_MCP_APPROVAL_RESOLVED
    idle --> idle: CHAT_CLEAR
```

### Chat States

| State | Description | Input Enabled | streamingMessageId |
|-------|-------------|---------------|-------------------|
| `idle` | Ready for input | ✅ Yes (except during MCP approval) | `undefined` |
| `sending` | Request in flight | ❌ No | `undefined` |
| `streaming` | Receiving chunks (or retrying) | ✅ Yes (messages queue) | Message ID |
| `error` | Failure occurred | If recoverable | `undefined` |

### Message Queue

When the AI is streaming, the input stays enabled. Messages sent during streaming are queued in `pendingMessages[]` (with optional file attachments) and shown as dismissible chips below the input. When the stream completes and status returns to `idle`, queued messages are combined (newline-separated) into a single message and auto-sent. Files from all queued messages are merged.

### Message Actions

Assistant messages display a hover action bar with Copy, Regenerate, and Feedback (👍👎) buttons. User messages show an Edit button on the last message.
- **Regenerate**: Removes the last assistant response and auto-resends the user's message
- **Edit**: Removes the target message and everything after it, then auto-resends with the edited text
- **Feedback**: Tracks 👍👎 ratings to Application Insights via `trackEvent`

### Tool-Use Visualization

When the AI agent uses tools (file search, code interpreter, function calls), the backend streams `toolUse` SSE events. The UI shows an inline indicator (e.g., "Searching files...") on the assistant message during tool execution.

### Input Enhancements

- **Voice Input**: Web Speech API microphone button with feature detection
- **Drag-and-Drop**: File drop zone overlay on the chat area
- **Keyboard Shortcuts**: ⌨️ toolbar button opens shortcuts dialog; `Ctrl+N` for new chat
- **Toolbar Layout**: Primary actions (attach, cancel, voice, new chat) are always visible; secondary actions (history, export, shortcuts, settings) are in a ⋯ overflow menu to keep the UI clean

### Conversation Management

- **Search**: Client-side filtering in the conversation sidebar
- **Export**: Download conversation as Markdown
- **Smart Scroll**: Auto-scroll only when near bottom; "↓ New messages" pill when scrolled up

### Stream Retry & Message Recovery

When a stream fails, the system automatically retries up to 3 times with exponential backoff. During retries, the assistant message shows a "Retrying (2/3)..." indicator via the `CHAT_STREAM_RETRY` action.

If all retries are exhausted, `CHAT_RECOVER_MESSAGE` removes the failed user message and assistant placeholder from the chat, restores the original message text to the input via `recoveredInput`, and shows an error banner. The user can simply press Send again.

---

### 2.3 End-to-End Message Flow

```mermaid
sequenceDiagram
    participant U as User
    participant UI as ChatInterface
    participant R as Reducer
    participant S as ChatService
    participant API as /api/chat/stream
    participant Agent as AI Agent

    U->>UI: Type message + Submit
    UI->>R: CHAT_SEND_MESSAGE
    Note over R: status: sending<br/>messages += userMsg

    UI->>S: streamChat(request)
    S->>API: POST (SSE)
    API->>Agent: CreateConversationAsync

    API-->>S: data: {conversationId}
    S->>R: CHAT_ADD_ASSISTANT_MESSAGE
    S->>R: CHAT_START_STREAM
    Note over R: status: streaming<br/>streamingMessageId = id

    loop Each chunk
        Agent-->>API: StreamingResponse
        API-->>S: data: {type: chunk}
        S->>R: CHAT_STREAM_CHUNK
        Note over R: Append to message content
    end

    alt Annotations received
        API-->>S: data: {type: annotations}
        S->>R: CHAT_STREAM_ANNOTATIONS
    end

    alt MCP Tool Approval needed
        API-->>S: data: {type: mcpApprovalRequest}
        S->>R: CHAT_MCP_APPROVAL_REQUEST
        Note over R: status: idle<br/>Show approval UI
        U->>UI: Approve/Deny
        UI->>R: CHAT_MCP_APPROVAL_RESOLVED
        Note over R: Mark card approved/rejected
        UI->>S: sendMcpApproval(id, approved, prevResponseId, convId)
        Note over S: Resume via /api/chat/stream with mcpApproval
    end

    API-->>S: data: {type: usage}
    S->>R: CHAT_STREAM_COMPLETE
    Note over R: status: idle<br/>Input enabled

    API-->>S: data: {type: done}
    Note over S: Exits stream reader
```

---

### 2.4 MCP Tool Approval Flow

```mermaid
stateDiagram-v2
    [*] --> streaming: Normal streaming

    streaming --> awaiting_approval: CHAT_MCP_APPROVAL_REQUEST
    
    state awaiting_approval {
        [*] --> show_card: Display approval UI
        show_card --> user_decides: User sees tool request
    }

    awaiting_approval --> sending: User approves
    awaiting_approval --> idle: User denies
    
    sending --> streaming: Resume with approval response

    note right of awaiting_approval
        mcpApproval: {
          id, toolName, serverLabel,
          arguments, previousResponseId
        }
        Conversation-bound client
        maintains pending MCP state
    end note
```

---

### 2.5 Error Recovery Flow

```mermaid
stateDiagram-v2
    [*] --> active: Normal operation

    active --> error: CHAT_ERROR

    state error {
        [*] --> check_type
        check_type --> recoverable: error.recoverable = true
        check_type --> fatal: error.recoverable = false
    }

    recoverable --> active: CHAT_CLEAR_ERROR
    fatal --> [*]: Page refresh required

    note right of recoverable
        Examples:
        - 401 (token expired)
        - 429 (rate limit)
        - Network timeout
    end note

    note right of fatal
        Examples:
        - Invalid agent config
        - Server 500
    end note
```

---

### 2.6 UI State Derivation

The UI state (`chatInputEnabled`) is derived from chat state:

```mermaid
flowchart LR
    subgraph ChatStatus
        idle[idle]
        sending[sending]
        streaming[streaming]
        error[error]
    end

    subgraph InputEnabled
        yes[✅ Enabled]
        no[❌ Disabled]
        maybe[⚠️ Conditional]
    end

    idle --> yes
    sending --> no
    streaming --> yes
    error --> maybe

    maybe --> yes
    maybe --> no

    note1[/"recoverable = true"/] --> yes
    note2[/"recoverable = false"/] --> no
```

---

### 2.7 Action Reference

| Action | From State(s) | To State | Side Effects |
|--------|--------------|----------|--------------|
| `AUTH_INITIALIZED` | initializing, unauthenticated | authenticated | Set user object |
| `AUTH_TOKEN_EXPIRED` | authenticated | unauthenticated | Clear user |
| `CHAT_SEND_MESSAGE` | idle | sending | Append user message |
| `CHAT_ADD_ASSISTANT_MESSAGE` | sending | sending | Create empty assistant msg |
| `CHAT_START_STREAM` | sending | streaming | Set conversationId, messageId |
| `CHAT_STREAM_CHUNK` | streaming | streaming | Append content to msg |
| `CHAT_STREAM_ANNOTATIONS` | streaming | streaming | Add citations to msg |
| `CHAT_MCP_APPROVAL_REQUEST` | streaming | idle | Add approval message, keep input disabled |
| `CHAT_MCP_APPROVAL_RESOLVED` | idle | idle | Mark approval as approved/rejected |
| `CHAT_STREAM_COMPLETE` | streaming | idle | Add usage, enable input |
| `CHAT_CANCEL_STREAM` | streaming | idle | Enable input |
| `CHAT_STREAM_RETRY` | streaming | streaming | Reset assistant msg content, show retry indicator |
| `CHAT_RECOVER_MESSAGE` | streaming | error | Remove failed msgs, restore input text, show error |
| `CHAT_REGENERATE` | idle | idle | Remove last assistant msg, store user text as regenerateText |
| `CHAT_EDIT_MESSAGE` | idle | idle | Remove target msg + after, store new text as regenerateText |
| `CHAT_CONSUMED_REGENERATE` | any | (unchanged) | Clear regenerateText after auto-send |
| `CHAT_STREAM_TOOL_USE` | streaming | streaming | Set activeToolUse on streaming message |
| `CHAT_CONSUMED_RECOVERED_INPUT` | any | (unchanged) | Clear recoveredInput after input pre-fill |
| `CHAT_QUEUE_MESSAGE` | any | (unchanged) | Append text to pendingMessages |
| `CHAT_DEQUEUE_MESSAGE` | any | (unchanged) | Remove message at index from pendingMessages |
| `CHAT_CLEAR_QUEUE` | any | (unchanged) | Clear pendingMessages array |
| `CHAT_ERROR` | any | error | Set error, conditional input |
| `CHAT_CLEAR_ERROR` | error | idle | Clear error + recoveredInput, enable input |
| `CHAT_CLEAR` | any | idle | Reset all chat state |
| `CHAT_LOAD_CONVERSATION` | any | idle | Replace messages, set conversationId, clear pendingMessages |
| `CHAT_LOAD_MESSAGES` | any | (unchanged) | Append historical messages without changing status |
| `CONVERSATIONS_LOADING` | any | (loading) | Set conversations loading state |
| `CONVERSATIONS_SET_LIST` | any | (list updated) | Populate conversation list |
| `CONVERSATIONS_TOGGLE_SIDEBAR` | any | (sidebar toggled) | Open/close conversation sidebar |
| `CONVERSATIONS_REMOVE` | any | (list updated) | Remove conversation from list |
| `CHAT_LOAD_MESSAGES` | any | (unchanged) | Append historical messages without changing status |
| `CONVERSATIONS_LOADING_DONE` | any | (loading cleared) | Reset isLoading without clearing data |

### 2.8 SSE Event → Action Mapping

The `ChatService` translates backend SSE events into reducer actions:

| SSE Event | Action Dispatched | Payload Transformation |
|-----------|-------------------|----------------------|
| `conversationId` | `CHAT_START_STREAM` | Extract `conversationId` from event |
| `chunk` | `CHAT_STREAM_CHUNK` | Extract `content` field |
| `annotations` | `CHAT_STREAM_ANNOTATIONS` | Map `AnnotationInfo[]` to `IAnnotation[]` |
| `mcpApprovalRequest` | `CHAT_MCP_APPROVAL_REQUEST` | Create approval message with `role: 'approval'` |
| `usage` | `CHAT_STREAM_COMPLETE` | Extract token counts and duration |
| `done` | No action — exits stream reader | `usage` is the sole trigger for CHAT_STREAM_COMPLETE |
| `toolUse` | `CHAT_STREAM_TOOL_USE` | `{toolName}` → `{messageId, toolName}` |
| `error` | `CHAT_ERROR` | Wrap message in `AppError` object |

### Performance Optimizations

The message list uses `useDeferredValue(messages)` to keep the input responsive during rapid streaming updates. The original `messages` array drives scroll behavior and accessibility announcements (immediate), while `deferredMessages` drives the heavy message list rendering (deferred).

---

## Part 3: Performance Patterns

### 3.1 Reducer Optimizations

**Early Returns**: Return same state reference when no changes occur to prevent unnecessary re-renders:

```typescript
case 'CHAT_STREAM_CHUNK': {
  const messageIndex = state.chat.messages.findIndex(
    msg => msg.id === action.messageId
  );
  
  if (messageIndex === -1) {
    return state; // Reference equality preserved - no re-render
  }
  // ...
}
```

**Targeted Array Updates**: Only recreate the modified message object:

```typescript
const updatedMessages = [...state.chat.messages];
updatedMessages[messageIndex] = {
  ...updatedMessages[messageIndex],
  content: updatedMessages[messageIndex].content + action.content,
};
```

This preserves reference equality for all other messages, preventing their components from re-rendering.

### 3.2 Development Logging

In development mode, the `AppContext` logs each action with state changes:

```
🔄 [14:32:01] CHAT_STREAM_CHUNK
Action: { type: 'CHAT_STREAM_CHUNK', messageId: '...', content: 'Hello' }
Changes: { 'chat.messages[2].content': 'He → Hello' }
```

Enable via: `import.meta.env.DEV` (automatic in Vite dev server).

---

## Part 4: Extending the State

### Adding a New Action

**Step 1**: Define the action type in `frontend/src/types/appState.ts`:

```typescript
export type AppAction = 
  // ... existing actions
  | { type: 'MY_NEW_ACTION'; payload: MyPayloadType }
```

**Step 2**: Handle in reducer `frontend/src/reducers/appReducer.ts`:

```typescript
case 'MY_NEW_ACTION':
  return {
    ...state,
    targetDomain: {
      ...state.targetDomain,
      field: action.payload,
    },
  };
```

**Step 3**: Dispatch from service or component:

```typescript
// In ChatService or component
dispatch({ type: 'MY_NEW_ACTION', payload: data });
```

**Step 4**: Consume in UI (automatic re-render):

```typescript
const { state } = useAppContext();
const value = state.targetDomain.field; // Updates on action
```

---

## Part 5: Backend Patterns

### 5.1 Attachment Validation

The backend enforces strict validation on file attachments before sending to AI Foundry:

**Image Limits**:

| Rule | Limit | Error |
|------|-------|-------|
| Max images per request | 5 | HTTP 400 |
| Max size per image | 5 MB (decoded) | HTTP 400 |
| Allowed MIME types | `image/png`, `image/jpeg`, `image/gif`, `image/webp` | HTTP 400 |

**Document Limits**:

| Rule | Limit | Error |
|------|-------|-------|
| Max files per request | 10 | HTTP 400 |
| Max size per file | 20 MB (decoded) | HTTP 400 |
| Allowed types | PDF, plain text, markdown, CSV, JSON, HTML, XML | HTTP 400 |
| Unsupported | DOCX, PPTX, XLSX (Office documents) | HTTP 400 |

Validation occurs in `BuildUserMessage()` before constructing the AI Foundry message payload.

### 5.2 Error Response Format (RFC 7807)

All API errors use standardized Problem Details format:

```json
{
  "title": "Authentication Failed",
  "status": 401,
  "detail": "Token expired at 2026-01-20T14:30:00Z",
  "traceId": "00-abc123..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Human-readable error summary |
| `status` | int | HTTP status code |
| `detail` | string | Specific error description |
| `traceId` | string? | Request correlation ID |
| `stackTrace` | string? | Exception stack (dev only, omitted in prod) |

### 5.3 Async Patterns

The backend follows strict async/await conventions:

**✅ Do**:
- Use `async`/`await` with `CancellationToken` on all I/O
- Pass `CancellationToken` through the entire call chain
- Use `IAsyncEnumerable<T>` for streaming responses
- Include `[EnumeratorCancellation]` attribute on streaming parameters

**❌ Don't**:
- Call `.Result` or `.Wait()` on async methods (causes deadlocks)
- Ignore `CancellationToken` parameters
- Use synchronous I/O in async contexts
- Block on async code in constructors

### 5.4 Configuration Keys

| Key | Source | Purpose | Example |
|-----|--------|---------|---------|
| `AzureAd:ClientId` | .env | Entra app client ID | `abc123-...` |
| `AzureAd:TenantId` | .env | Entra tenant ID | `def456-...` |
| `AI_AGENT_ENDPOINT` | .env | AI Foundry project URL | `https://....api.azureml.ms` |
| `AI_AGENT_ID` | .env | Agent name (v2 API) | `my-agent` |
| `ASPNETCORE_ENVIRONMENT` | Environment | Development/Production | `Development` |
| `ENTRA_BACKEND_CLIENT_ID` | Container App env | Backend app ID for OBO | `59bc6af3-...` |
| `MANAGED_IDENTITY_CLIENT_ID` | Container App env | User-assigned MI client ID for OBO (`OBO_MANAGED_IDENTITY_CLIENT_ID` is a deprecated alias) | `abc123-...` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Container App env | Azure Monitor OpenTelemetry export (backend traces/metrics) | `InstrumentationKey=...` |
| `APPLICATIONINSIGHTS_FRONTEND_CONNECTION_STRING` | Docker build arg | Frontend browser telemetry (injected at build as `VITE_APPLICATIONINSIGHTS_CONNECTION_STRING`) | `InstrumentationKey=...` |

The `.env` file is auto-generated by `postprovision.ps1` during `azd up` (after Bicep provisions the Entra app and infrastructure).

---

## Part 6: File Reference

### Backend

| File | Purpose |
|------|---------|
| [backend/WebApp.Api/Program.cs](backend/WebApp.Api/Program.cs) | Request pipeline, JWT validation, SSE endpoints |
| [backend/WebApp.Api/Services/AgentFrameworkService.cs](backend/WebApp.Api/Services/AgentFrameworkService.cs) | Agent loading, streaming, credential management |
| [backend/WebApp.Api/Models/StreamChunk.cs](backend/WebApp.Api/Models/StreamChunk.cs) | SSE chunk types (text, annotations, MCP) |
| [backend/WebApp.Api/Models/ChatRequest.cs](backend/WebApp.Api/Models/ChatRequest.cs) | Request payload with attachments |

### Frontend

| File | Purpose |
|------|---------|
| [frontend/src/types/appState.ts](frontend/src/types/appState.ts) | State & action type definitions |
| [frontend/src/reducers/appReducer.ts](frontend/src/reducers/appReducer.ts) | Pure reducer with all transitions |
| [frontend/src/contexts/AppContext.tsx](frontend/src/contexts/AppContext.tsx) | Provider with MSAL integration |
| [frontend/src/services/chatService.ts](frontend/src/services/chatService.ts) | SSE client dispatching actions |

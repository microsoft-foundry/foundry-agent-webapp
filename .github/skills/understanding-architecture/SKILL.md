---
name: understanding-architecture
description: Provides architecture overview with state machines, SSE event flow, and file mappings. Use when understanding system design, debugging state issues, or maintaining ARCHITECTURE-FLOW.md.
---

# Understanding Architecture

**Load this skill when**: Understanding system design, debugging state transitions, tracing SSE events, or updating architecture documentation.

## Quick Reference

### System Overview

| Layer | Tech | Port | Entry Point |
|-------|------|------|-------------|
| Frontend | React 19 + Vite | 5173 | `frontend/src/App.tsx` |
| Backend | ASP.NET Core 9 | 8080 | `backend/WebApp.Api/Program.cs` |
| Auth | MSAL.js → JWT Bearer | — | `frontend/src/config/authConfig.ts` |
| AI SDK | Azure.AI.Projects (GA) + Azure.AI.Extensions.OpenAI | — | `backend/.../AgentFrameworkService.cs` |

### Data Flow

```text
User → ChatInput → CHAT_SEND_MESSAGE → ChatService.sendMessage()
     → POST /api/chat/stream (JWT) → AgentFrameworkService.StreamMessageAsync()
     → AI Foundry → SSE chunks → parseSseLine() → Reducer actions → UI update
```

---

## State Machines

### Chat States

```text
idle ──CHAT_SEND_MESSAGE──► sending ──CHAT_START_STREAM──► streaming
  ▲                            │                              │
  │                            ▼                              ▼
  └──CHAT_CLEAR_ERROR─── error ◄──CHAT_ERROR──────────────────┤
  │                                                           │
  └──CHAT_STREAM_COMPLETE / CHAT_CANCEL_STREAM / CHAT_MCP_APPROVAL_REQUEST
```

| State | Input Enabled | streamingMessageId |
|-------|---------------|-------------------|
| `idle` | ✅ Yes | `undefined` |
| `sending` | ❌ No | `undefined` |
| `streaming` | ❌ No | Message ID |
| `error` | If recoverable | `undefined` |

### Auth States

```text
initializing ──AUTH_INITIALIZED──► authenticated ──AUTH_TOKEN_EXPIRED──► unauthenticated
                                         │                                    │
                                         └───────────AUTH_INITIALIZED──────────┘
```

---

## SSE Event Flow

### Backend → Frontend Mapping

| SSE Event | Backend Method | Frontend Action | Reducer Effect |
|-----------|----------------|-----------------|----------------|
| `conversationId` | `WriteConversationIdEvent` | `CHAT_START_STREAM` | Set conversationId |
| `chunk` | `WriteChunkEvent` | `CHAT_STREAM_CHUNK` | Append content |
| `annotations` | `WriteAnnotationsEvent` | `CHAT_STREAM_ANNOTATIONS` | Add citations |
| `mcpApprovalRequest` | `WriteMcpApprovalRequestEvent` | `CHAT_MCP_APPROVAL_REQUEST` | Show approval UI |
| `usage` | `WriteUsageEvent` | `CHAT_STREAM_COMPLETE` | Add token counts |
| `done` | `WriteDoneEvent` | `CHAT_STREAM_COMPLETE` | Finalize |
| `error` | `WriteErrorEvent` | `CHAT_ERROR` | Set error state |

### Event Sequence

```text
1. conversationId  (always first)
2. chunk           (0-N times)
3. annotations     (0-N times, after item complete)
4. mcpApprovalRequest (0-1 times, pauses stream)
5. usage           (always before done)
6. done            (always last)
```

---

## Key Files by Domain

### State Management
| File | Purpose |
|------|---------|
| `frontend/src/types/appState.ts` | State & action type definitions |
| `frontend/src/reducers/appReducer.ts` | All state transitions |
| `frontend/src/contexts/AppContext.tsx` | Provider + dev logging |

### SSE Streaming
| File | Purpose |
|------|---------|
| `backend/WebApp.Api/Program.cs` | SSE endpoints + Write*Event helpers |
| `frontend/src/services/chatService.ts` | SSE client + action dispatch |
| `frontend/src/utils/sseParser.ts` | Line parsing + event types |

### AI Integration
| File | Purpose |
|------|---------|
| `backend/.../AgentFrameworkService.cs` | Agent loading + streaming |
| `backend/.../Models/StreamChunk.cs` | Chunk types (text, annotations, MCP) |
| `backend/.../Models/ChatRequest.cs` | Request payload structure |

---

## Full Documentation

For complete diagrams and detailed flows, see:
- **[ARCHITECTURE-FLOW.md](../../../ARCHITECTURE-FLOW.md)** - Full Mermaid diagrams
- **Part 1**: Backend flow (request pipeline, credential resolution, agent loading)
- **Part 2**: Frontend state (auth, chat, UI state machines)
- **Part 3**: Performance patterns (reducer optimizations)
- **Part 4**: Extending the state (adding new actions)
- **Part 5**: Backend patterns (validation, error format, async)
- **Part 6**: File reference (all key files)

---

## Maintaining ARCHITECTURE-FLOW.md

### When to Update

Update the architecture document when:

| Change Type | What to Update |
|-------------|----------------|
| New SSE event type | Section 1.5 (Backend SSE Event Types), Section 2.8 (SSE → Action Mapping) |
| New reducer action | Section 2.7 (Action Reference), state machine diagrams |
| New API endpoint | Section 1.1 (Request Pipeline flowchart) |
| New auth state | Section 2.1 (Authentication State Machine) |
| New chat state | Section 2.2 (Chat State Machine) |
| File moved/renamed | Part 6 (File Reference tables) |
| Validation rules changed | Section 5.1 (Attachment Validation) |

### Validation Checklist

Before committing architecture doc changes:

```text
□ Mermaid Diagrams
  □ All states match code (appState.ts types)
  □ All transitions match reducer (appReducer.ts cases)
  □ Diagram syntax renders without errors

□ Tables
  □ SSE events match Program.cs Write*Event methods
  □ Actions match AppAction type union
  □ File paths are lowercase (case-sensitive filesystems)

□ Code Snippets
  □ Patterns match actual code
  □ Variable names correct
  □ Examples would compile/run

□ File Links
  □ All referenced files exist
  □ Paths use correct case (chatService.ts not ChatService.ts)
```

### Source of Truth Mapping

| Document Section | Source Code |
|------------------|-------------|
| Request Pipeline (1.1) | `Program.cs` middleware + endpoints |
| Credential Resolution (1.2) | `AgentFrameworkService.cs` constructor |
| Agent Loading (1.3) | `AgentFrameworkService.GetAgentAsync()` |
| SSE Events (1.5) | `Program.cs` static Write*Event methods |
| Auth States (2.1) | `appState.ts` auth.status type |
| Chat States (2.2) | `appState.ts` chat.status type |
| Action Reference (2.7) | `appState.ts` AppAction type |
| SSE → Action (2.8) | `chatService.ts` processStream switch |
| Attachment Limits (5.1) | `AgentFrameworkService.cs` Max* constants |

### Quick Sync Commands

```powershell
# Find all SSE event types in backend
Select-String -Path "backend/WebApp.Api/Program.cs" -Pattern "type.*="

# Find all reducer actions
Select-String -Path "frontend/src/types/appState.ts" -Pattern "type:"

# Find SSE parsing
Select-String -Path "frontend/src/services/chatService.ts" -Pattern "case '"

# Verify file links exist
Get-ChildItem -Recurse -Include "chatService.ts","appReducer.ts","appState.ts"
```

### Cross-Reference with DeepWiki

DeepWiki (https://deepwiki.com/microsoft-foundry/foundry-agent-webapp) indexes the repo automatically. After major architecture changes:

1. Check DeepWiki re-indexes (usually within 24 hours)
2. Verify diagrams match between ARCHITECTURE-FLOW.md and DeepWiki
3. Note: DeepWiki may show older commit - check "Last indexed" date

---

## Common Architecture Questions

### "How does a message flow end-to-end?"
See [ARCHITECTURE-FLOW.md#2.3](../../../ARCHITECTURE-FLOW.md) - End-to-End Message Flow sequence diagram.

### "What happens when streaming is cancelled?"
1. User clicks Stop button or presses Escape
2. `ChatService.cancelStream()` sets `streamCancelled = true` and calls `abort()`
3. `CHAT_CANCEL_STREAM` action dispatched
4. Reducer sets `status: idle`, clears `streamingMessageId`, enables input

### "How does MCP tool approval work?"
1. Backend yields `StreamChunk.McpApproval` when `McpToolCallApprovalRequestItem` received
2. Frontend dispatches `CHAT_MCP_APPROVAL_REQUEST` with approval details
3. Reducer adds approval message, sets status to `idle` (but input stays disabled)
4. User clicks Approve/Deny
5. `ChatService.sendMcpApproval()` resumes with approval response

### "Where is the JWT validated?"
`Program.cs` → `AddMicrosoftIdentityWebApi()` + `RequireAuthorization(ScopePolicyName)` on each endpoint.

### "How are credentials resolved in production vs development?"
- **Development**: `ChainedTokenCredential(AzureCliCredential, AzureDeveloperCliCredential)`
- **Production**: `ManagedIdentityCredential(miClientId)` (user-assigned MI with `MANAGED_IDENTITY_CLIENT_ID`)

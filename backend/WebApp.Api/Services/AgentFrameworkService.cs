using Azure.AI.Projects;
using Azure.AI.Projects.OpenAI;
using Azure.Core;
using Azure.Identity;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI.Responses;
using System.Runtime.CompilerServices;
using WebApp.Api.Models;

namespace WebApp.Api.Services;

#pragma warning disable OPENAI001

/// <summary>
/// Azure AI Foundry agent service using v2 Agents API.
/// </summary>
/// <remarks>
/// Uses Microsoft.Agents.AI.AzureAI extension methods on AIProjectClient for agent loading,
/// and direct ProjectResponsesClient for streaming (required for annotations, MCP approvals).
/// See .github/skills/researching-azure-ai-sdk/SKILL.md for SDK patterns.
/// </remarks>
public class AgentFrameworkService : IAgentCrudService, IDisposable
{
    private readonly AIProjectClient _projectClient;
    private readonly string _agentId;
    private readonly ILogger<AgentFrameworkService> _logger;
    private ChatClientAgent? _cachedAgent;
    private AgentMetadataResponse? _cachedMetadata;
    private readonly SemaphoreSlim _agentLock = new(1, 1);
    private bool _disposed = false;
    private ResponseTokenUsage? _lastUsage;

    public AgentFrameworkService(
        IConfiguration configuration,
        ILogger<AgentFrameworkService> logger)
    {
        _logger = logger;

        var endpoint = configuration["AI_AGENT_ENDPOINT"]
            ?? throw new InvalidOperationException("AI_AGENT_ENDPOINT is not configured");

        _agentId = configuration["AI_AGENT_ID"]
            ?? throw new InvalidOperationException("AI_AGENT_ID is not configured");

        _logger.LogDebug(
            "Initializing AgentFrameworkService: endpoint={Endpoint}, agentId={AgentId}", 
            endpoint, 
            _agentId);

        TokenCredential credential;
        var environment = configuration["ASPNETCORE_ENVIRONMENT"] ?? "Production";

        if (environment == "Development")
        {
            _logger.LogInformation("Development: Using ChainedTokenCredential (AzureCli -> AzureDeveloperCli)");
            credential = new ChainedTokenCredential(
                new AzureCliCredential(),
                new AzureDeveloperCliCredential()
            );
        }
        else
        {
            _logger.LogInformation("Production: Using ManagedIdentityCredential (system-assigned)");
            credential = new ManagedIdentityCredential();
        }

        _projectClient = new AIProjectClient(new Uri(endpoint), credential);
        _logger.LogInformation("AIProjectClient initialized successfully");
    }

    /// <summary>
    /// Get agent via Microsoft Agent Framework extension methods.
    /// Uses AIProjectClient.GetAIAgentAsync() which wraps v2 Agents API.
    /// </summary>
    private async Task<ChatClientAgent> GetAgentAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (_cachedAgent != null)
            return _cachedAgent;

        await _agentLock.WaitAsync(cancellationToken);
        try
        {
            if (_cachedAgent != null)
                return _cachedAgent;

            _logger.LogInformation("Loading agent via Agent Framework: {AgentId}", _agentId);

            // Use Microsoft.Agents.AI.AzureAI extension method - handles v2 Agents API internally
            _cachedAgent = await _projectClient.GetAIAgentAsync(
                name: _agentId,
                cancellationToken: cancellationToken);

            // Get the AgentVersion from the cached agent for metadata
            var agentVersion = _cachedAgent.GetService<AgentVersion>();
            var definition = agentVersion?.Definition as PromptAgentDefinition;
            
            _logger.LogInformation(
                "Loaded agent: name={AgentName}, model={Model}, version={Version}", 
                agentVersion?.Name ?? _agentId,
                definition?.Model ?? "unknown",
                agentVersion?.Version ?? "latest");

            // Log StructuredInputs at debug level for troubleshooting
            if (definition?.StructuredInputs != null && definition.StructuredInputs.Count > 0)
            {
                _logger.LogDebug("Agent has {Count} StructuredInputs: {Keys}", 
                    definition.StructuredInputs.Count, 
                    string.Join(", ", definition.StructuredInputs.Keys));
            }

            return _cachedAgent;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load agent: {AgentId}", _agentId);
            throw;
        }
        finally
        {
            _agentLock.Release();
        }
    }

    /// <summary>
    /// Streams agent response for a message using ProjectResponsesClient (Responses API).
    /// Returns StreamChunk objects containing text deltas, annotations, or MCP approval requests.
    /// </summary>
    /// <remarks>
    /// Uses direct ProjectResponsesClient instead of IChatClient because we need access to:
    /// - McpToolCallApprovalRequestItem for MCP approval flows
    /// - FileSearchCallResponseItem for file search quotes  
    /// - MessageResponseItem.OutputTextAnnotations for citations
    /// The IChatClient abstraction doesn't expose these specialized response types.
    /// </remarks>
    public async IAsyncEnumerable<StreamChunk> StreamMessageAsync(
        string conversationId,
        string message,
        List<string>? imageDataUris = null,
        List<FileAttachment>? fileDataUris = null,
        string? previousResponseId = null,
        McpApprovalResponse? mcpApproval = null,
        string? agentId = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        var effectiveAgentId = !string.IsNullOrEmpty(agentId) ? agentId : _agentId;

        _logger.LogInformation(
            "Streaming message to conversation: {ConversationId}, AgentId: {AgentId}, ImageCount: {ImageCount}, FileCount: {FileCount}, HasApproval: {HasApproval}",
            conversationId,
            effectiveAgentId,
            imageDataUris?.Count ?? 0,
            fileDataUris?.Count ?? 0,
            mcpApproval != null);

        // Get ProjectResponsesClient for the agent and conversation
        ProjectResponsesClient responsesClient
            = _projectClient.OpenAI.GetProjectResponsesClientForAgent(
                new AgentReference(effectiveAgentId),
                conversationId);

        CreateResponseOptions options = new() { StreamingEnabled = true };

        // If continuing from MCP approval, link to previous response
        if (!string.IsNullOrEmpty(previousResponseId) && mcpApproval != null)
        {
            options.PreviousResponseId = previousResponseId;
            options.InputItems.Add(ResponseItem.CreateMcpApprovalResponseItem(
                mcpApproval.ApprovalRequestId,
                mcpApproval.Approved));
            
            _logger.LogInformation(
                "Resuming with MCP approval: RequestId={RequestId}, Approved={Approved}",
                mcpApproval.ApprovalRequestId,
                mcpApproval.Approved);
        }
        else
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                _logger.LogWarning("Attempted to stream empty message to conversation {ConversationId}", conversationId);
                throw new ArgumentException("Message cannot be null or whitespace", nameof(message));
            }

            // Build user message with optional images and files
            ResponseItem userMessage = BuildUserMessage(message, imageDataUris, fileDataUris);
            options.InputItems.Add(userMessage);
        }

        // Dictionary to collect file search results for quote extraction
        var fileSearchQuotes = new Dictionary<string, string>();

        await foreach (StreamingResponseUpdate update
            in responsesClient.CreateResponseStreamingAsync(
                options: options,
                cancellationToken: cancellationToken))
        {
            if (update is StreamingResponseOutputTextDeltaUpdate deltaUpdate)
            {
                yield return StreamChunk.Text(deltaUpdate.Delta);
            }
            else if (update is StreamingResponseOutputItemDoneUpdate itemDoneUpdate)
            {
                // Check for MCP tool approval request
                if (itemDoneUpdate.Item is McpToolCallApprovalRequestItem mcpApprovalItem)
                {
                    _logger.LogInformation(
                        "MCP tool approval requested: Id={Id}, Tool={Tool}, Server={Server}",
                        mcpApprovalItem.Id,
                        mcpApprovalItem.ToolName,
                        mcpApprovalItem.ServerLabel);
                    
                    // Parse tool arguments from BinaryData to string (JSON)
                    string? argumentsJson = mcpApprovalItem.ToolArguments?.ToString();
                    
                    yield return StreamChunk.McpApproval(new McpApprovalRequest
                    {
                        Id = mcpApprovalItem.Id,
                        ToolName = mcpApprovalItem.ToolName ?? "Unknown tool",
                        ServerLabel = mcpApprovalItem.ServerLabel ?? "MCP Server",
                        Arguments = argumentsJson
                    });
                    continue;
                }
                
                // Capture file search results for quote extraction
                if (itemDoneUpdate.Item is FileSearchCallResponseItem fileSearchItem)
                {
                    foreach (var result in fileSearchItem.Results)
                    {
                        if (!string.IsNullOrEmpty(result.FileId) && !string.IsNullOrEmpty(result.Text))
                        {
                            fileSearchQuotes[result.FileId] = result.Text;
                            _logger.LogDebug(
                                "Captured file search quote for FileId={FileId}, QuoteLength={Length}", 
                                result.FileId, 
                                result.Text.Length);
                        }
                    }
                    continue;
                }
                
                // Extract annotations/citations from completed output items
                var annotations = ExtractAnnotations(itemDoneUpdate.Item, fileSearchQuotes);
                if (annotations.Count > 0)
                {
                    _logger.LogInformation("Extracted {Count} annotations from response", annotations.Count);
                    yield return StreamChunk.WithAnnotations(annotations);
                }
            }
            else if (update is StreamingResponseCompletedUpdate completedUpdate)
            {
                _lastUsage = completedUpdate.Response.Usage;
            }
            else if (update is StreamingResponseErrorUpdate errorUpdate)
            {
                _logger.LogError("Stream error: {Error}", errorUpdate.Message);
                throw new InvalidOperationException($"Stream error: {errorUpdate.Message}");
            }
        }

        _logger.LogInformation("Completed streaming for conversation: {ConversationId}", conversationId);
    }

    /// <summary>
    /// Supported image MIME types for vision capabilities.
    /// </summary>
    private static readonly HashSet<string> AllowedImageTypes = 
        ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];

    /// <summary>
    /// Supported document MIME types for file input.
    /// Note: Office documents (docx, pptx, xlsx) are NOT supported - they cannot be parsed.
    /// </summary>
    private static readonly HashSet<string> AllowedDocumentTypes = 
        [
            "application/pdf",
            "text/plain",
            "text/markdown",
            "text/csv",
            "application/json",
            "text/html",
            "application/xml",
            "text/xml"
        ];

    /// <summary>
    /// Text-based document MIME types that should be inlined as text rather than sent as file input.
    /// The Responses API only supports PDF for CreateInputFilePart.
    /// </summary>
    private static readonly HashSet<string> TextBasedDocumentTypes = 
        [
            "text/plain",
            "text/markdown",
            "text/csv",
            "application/json",
            "text/html",
            "application/xml",
            "text/xml"
        ];

    /// <summary>
    /// MIME types that can be sent as file input (only PDF is currently supported by Responses API).
    /// </summary>
    private static readonly HashSet<string> FileInputTypes = 
        [
            "application/pdf"
        ];

    /// <summary>
    /// Maximum number of images per message.
    /// </summary>
    private const int MaxImageCount = 5;

    /// <summary>
    /// Maximum number of files per message.
    /// </summary>
    private const int MaxFileCount = 10;

    /// <summary>
    /// Maximum size per image in bytes (5MB).
    /// </summary>
    private const long MaxImageSizeBytes = 5 * 1024 * 1024;

    /// <summary>
    /// Maximum size per document file in bytes (20MB).
    /// </summary>
    private const long MaxFileSizeBytes = 20 * 1024 * 1024;

    /// <summary>
    /// Builds a ResponseItem for the user message with optional image and file attachments.
    /// Validates count, size, MIME type, and Base64 format for both images and documents.
    /// </summary>
    private static ResponseItem BuildUserMessage(
        string message, 
        List<string>? imageDataUris,
        List<FileAttachment>? fileDataUris = null)
    {
        if ((imageDataUris == null || imageDataUris.Count == 0) && 
            (fileDataUris == null || fileDataUris.Count == 0))
        {
            return ResponseItem.CreateUserMessageItem(message);
        }

        var contentParts = new List<ResponseContentPart>
        {
            ResponseContentPart.CreateInputTextPart(message)
        };

        var errors = new List<string>();

        // Process images
        if (imageDataUris != null && imageDataUris.Count > 0)
        {
            // Enforce maximum image count
            if (imageDataUris.Count > MaxImageCount)
            {
                throw new ArgumentException(
                    $"Invalid image attachments: Too many images ({imageDataUris.Count}), maximum {MaxImageCount} allowed");
            }

            for (int i = 0; i < imageDataUris.Count; i++)
            {
                var dataUri = imageDataUris[i];
                
                // Validate data URI format
                if (!dataUri.StartsWith("data:"))
                {
                    errors.Add($"Image {i + 1}: Invalid format (must be data URI)");
                    continue;
                }

                var semiIndex = dataUri.IndexOf(';');
                var commaIndex = dataUri.IndexOf(',');
                
                if (semiIndex < 0 || commaIndex < 0 || commaIndex < semiIndex)
                {
                    errors.Add($"Image {i + 1}: Malformed data URI");
                    continue;
                }

                // Extract and validate MIME type
                var mediaType = dataUri[5..semiIndex].ToLowerInvariant();
                if (!AllowedImageTypes.Contains(mediaType))
                {
                    errors.Add($"Image {i + 1}: Unsupported type '{mediaType}'. Allowed: PNG, JPEG, GIF, WebP");
                    continue;
                }

                // Validate Base64 and decode
                var base64Data = dataUri[(commaIndex + 1)..];
                try
                {
                    var bytes = Convert.FromBase64String(base64Data);
                    
                    // Enforce size limit
                    if (bytes.Length > MaxImageSizeBytes)
                    {
                        var sizeMB = bytes.Length / (1024.0 * 1024.0);
                        errors.Add($"Image {i + 1}: Size {sizeMB:F1}MB exceeds maximum 5MB");
                        continue;
                    }
                    
                    contentParts.Add(ResponseContentPart.CreateInputImagePart(
                        BinaryData.FromBytes(bytes),
                        mediaType));
                }
                catch (FormatException)
                {
                    errors.Add($"Image {i + 1}: Invalid Base64 encoding");
                }
            }
        }

        // Process file attachments
        if (fileDataUris != null && fileDataUris.Count > 0)
        {
            // Enforce maximum file count
            if (fileDataUris.Count > MaxFileCount)
            {
                throw new ArgumentException(
                    $"Invalid file attachments: Too many files ({fileDataUris.Count}), maximum {MaxFileCount} allowed");
            }

            for (int i = 0; i < fileDataUris.Count; i++)
            {
                var file = fileDataUris[i];
                var dataUri = file.DataUri;
                
                // Validate data URI format
                if (!dataUri.StartsWith("data:"))
                {
                    errors.Add($"File {i + 1} ({file.FileName}): Invalid format (must be data URI)");
                    continue;
                }

                var semiIndex = dataUri.IndexOf(';');
                var commaIndex = dataUri.IndexOf(',');
                
                if (semiIndex < 0 || commaIndex < 0 || commaIndex < semiIndex)
                {
                    errors.Add($"File {i + 1} ({file.FileName}): Malformed data URI");
                    continue;
                }

                // Extract and validate MIME type
                var mediaType = dataUri[5..semiIndex].ToLowerInvariant();
                if (!AllowedDocumentTypes.Contains(mediaType))
                {
                    errors.Add($"File {i + 1} ({file.FileName}): Unsupported type '{mediaType}'");
                    continue;
                }

                // Verify MIME type matches what was declared
                if (!string.Equals(mediaType, file.MimeType.ToLowerInvariant(), StringComparison.OrdinalIgnoreCase))
                {
                    errors.Add($"File {i + 1} ({file.FileName}): MIME type mismatch (declared: {file.MimeType}, detected: {mediaType})");
                    continue;
                }

                // Validate Base64 and decode
                var base64Data = dataUri[(commaIndex + 1)..];
                try
                {
                    var bytes = Convert.FromBase64String(base64Data);
                    
                    // Enforce size limit
                    if (bytes.Length > MaxFileSizeBytes)
                    {
                        var sizeMB = bytes.Length / (1024.0 * 1024.0);
                        errors.Add($"File {i + 1} ({file.FileName}): Size {sizeMB:F1}MB exceeds maximum 20MB");
                        continue;
                    }
                    
                    // Handle text-based files by inlining their content
                    // The Responses API only supports PDF for CreateInputFilePart
                    if (TextBasedDocumentTypes.Contains(mediaType))
                    {
                        // Decode text content and add as inline text with filename context
                        var textContent = System.Text.Encoding.UTF8.GetString(bytes);
                        var inlineText = $"\n\n--- Content of {file.FileName} ---\n{textContent}\n--- End of {file.FileName} ---\n";
                        contentParts.Add(ResponseContentPart.CreateInputTextPart(inlineText));
                    }
                    else if (FileInputTypes.Contains(mediaType))
                    {
                        // PDF files can be sent as file input
                        contentParts.Add(ResponseContentPart.CreateInputFilePart(
                            BinaryData.FromBytes(bytes),
                            mediaType,
                            file.FileName));
                    }
                }
                catch (FormatException)
                {
                    errors.Add($"File {i + 1} ({file.FileName}): Invalid Base64 encoding");
                }
            }
        }

        if (errors.Count > 0)
        {
            throw new ArgumentException($"Invalid attachments: {string.Join("; ", errors)}");
        }

        return ResponseItem.CreateUserMessageItem(contentParts);
    }

    /// <summary>
    /// Extracts annotation information from a completed response item.
    /// </summary>
    private List<AnnotationInfo> ExtractAnnotations(
        ResponseItem? item, 
        Dictionary<string, string>? fileSearchQuotes = null)
    {
        var annotations = new List<AnnotationInfo>();
        
        if (item is not MessageResponseItem messageItem)
            return annotations;

        foreach (var content in messageItem.Content)
        {
            if (content.OutputTextAnnotations == null) continue;
            
            foreach (var annotation in content.OutputTextAnnotations)
            {
                var annotationInfo = annotation switch
                {
                    UriCitationMessageAnnotation uriAnnotation => new AnnotationInfo
                    {
                        Type = "uri_citation",
                        Label = uriAnnotation.Title ?? "Source",
                        Url = uriAnnotation.Uri?.ToString(),
                        StartIndex = uriAnnotation.StartIndex,
                        EndIndex = uriAnnotation.EndIndex
                    },
                    
                    FileCitationMessageAnnotation fileCitation => new AnnotationInfo
                    {
                        Type = "file_citation",
                        Label = fileCitation.Filename ?? fileCitation.FileId ?? "File",
                        FileId = fileCitation.FileId,
                        StartIndex = fileCitation.Index,
                        EndIndex = fileCitation.Index,
                        Quote = fileSearchQuotes?.TryGetValue(fileCitation.FileId ?? string.Empty, out var quote) == true 
                            ? quote : null
                    },
                    
                    FilePathMessageAnnotation filePath => new AnnotationInfo
                    {
                        Type = "file_path",
                        Label = "Generated File",
                        FileId = filePath.FileId,
                        StartIndex = filePath.Index,
                        EndIndex = filePath.Index
                    },
                    
                    ContainerFileCitationMessageAnnotation containerCitation => new AnnotationInfo
                    {
                        Type = "container_file_citation",
                        Label = containerCitation.Filename ?? "Container File",
                        FileId = containerCitation.FileId,
                        StartIndex = containerCitation.StartIndex,
                        EndIndex = containerCitation.EndIndex,
                        Quote = fileSearchQuotes?.TryGetValue(containerCitation.FileId, out var containerQuote) == true 
                            ? containerQuote : null
                    },
                    
                    _ => null
                };
                
                if (annotationInfo != null)
                    annotations.Add(annotationInfo);
            }
        }

        return annotations;
    }

    /// <summary>
    /// Create a new conversation for the agent.
    /// Uses ProjectConversation from Azure.AI.Projects for server-managed state.
    /// </summary>
    public async Task<string> CreateConversationAsync(string? firstMessage = null, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        try
        {
            _logger.LogInformation("Creating new conversation");
            
            ProjectConversationCreationOptions conversationOptions = new();

            if (!string.IsNullOrEmpty(firstMessage))
            {
                // Store title in metadata (truncate to 50 chars)
                var title = firstMessage.Length > 50 
                    ? firstMessage[..50] + "..."
                    : firstMessage;
                conversationOptions.Metadata["title"] = title;
            }

            ProjectConversation conversation
                = await _projectClient.OpenAI.Conversations.CreateProjectConversationAsync(
                    conversationOptions,
                    cancellationToken);

            _logger.LogInformation(
                "Created conversation: {ConversationId}", 
                conversation.Id);
            return conversation.Id;
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("Conversation creation was cancelled");
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create conversation");
            throw;
        }
    }

    /// <summary>
    /// Get the agent metadata (name, description, etc.) for display in UI.
    /// Uses Agent Framework's ChatClientAgent which provides access to AgentVersion.
    /// </summary>
    public async Task<AgentMetadataResponse> GetAgentMetadataAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        // Ensure agent is loaded via Agent Framework
        var agent = await GetAgentAsync(cancellationToken);

        if (_cachedMetadata != null)
            return _cachedMetadata;

        // Get AgentVersion from the ChatClientAgent's services
        var agentVersion = agent.GetService<AgentVersion>();
        if (agentVersion == null)
            throw new InvalidOperationException("Agent version not available from ChatClientAgent");

        var definition = agentVersion.Definition as PromptAgentDefinition;
        var metadata = agentVersion.Metadata?.ToDictionary(kvp => kvp.Key, kvp => kvp.Value);

        // Log metadata keys at debug level for troubleshooting
        if (metadata != null && metadata.Count > 0)
        {
            _logger.LogDebug("Agent metadata keys: {Keys}", string.Join(", ", metadata.Keys));
        }

        // Parse starter prompts from metadata
        List<string>? starterPrompts = ParseStarterPrompts(metadata);

        _cachedMetadata = new AgentMetadataResponse
        {
            Id = _agentId,
            Object = "agent",
            CreatedAt = agentVersion.CreatedAt.ToUnixTimeSeconds(),
            Name = agentVersion.Name ?? "AI Assistant",
            Description = agentVersion.Description,
            Model = definition?.Model ?? string.Empty,
            Instructions = definition?.Instructions ?? string.Empty,
            Metadata = metadata,
            StarterPrompts = starterPrompts
        };

        return _cachedMetadata;
    }

    /// <summary>
    /// Parse starter prompts from agent metadata.
    /// Azure AI Foundry stores starter prompts as newline-separated text in the "starterPrompts" metadata key.
    /// Example: "How's the weather?\nIs your fridge running?\nTell me a joke"
    /// </summary>
    private List<string>? ParseStarterPrompts(Dictionary<string, string>? metadata)
    {
        if (metadata == null)
            return null;

        // Azure AI Foundry uses camelCase "starterPrompts" key with newline-separated values
        if (!metadata.TryGetValue("starterPrompts", out var starterPromptsValue))
            return null;

        if (string.IsNullOrWhiteSpace(starterPromptsValue))
            return null;

        // Split by newlines and filter out empty entries
        var prompts = starterPromptsValue
            .Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Trim())
            .Where(p => !string.IsNullOrEmpty(p))
            .ToList();

        if (prompts.Count > 0)
        {
            _logger.LogDebug("Parsed {Count} starter prompts from agent metadata", prompts.Count);
            return prompts;
        }

        return null;
    }

    /// <summary>
    /// Get basic agent info string (for debugging).
    /// </summary>
    public async Task<string> GetAgentInfoAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        var agent = await GetAgentAsync(cancellationToken);
        var agentVersion = agent.GetService<AgentVersion>();
        return agentVersion?.Name ?? _agentId;
    }

    /// <summary>
    /// Get token usage from the last streaming response.
    /// </summary>
    public (int InputTokens, int OutputTokens, int TotalTokens)? GetLastUsage() =>
        _lastUsage is null ? null : (_lastUsage.InputTokenCount, _lastUsage.OutputTokenCount, _lastUsage.TotalTokenCount);

    /// <summary>
    /// Create a new agent version via the v2 Agents API.
    /// </summary>
    public async Task<CreateAgentResponse> CreateAgentAsync(
        CreateAgentRequest request,
        CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        _logger.LogInformation("Creating agent: {Name}, Model: {Model}", request.Name, request.Model);

        var definition = new PromptAgentDefinition(request.Model)
        {
            Instructions = request.Instructions,
            Temperature = request.Temperature,
            TopP = request.TopP
        };

        var options = new AgentVersionCreationOptions(definition)
        {
            Description = request.Description
        };

        if (request.Metadata != null)
        {
            foreach (var (key, value) in request.Metadata)
            {
                options.Metadata[key] = value;
            }
        }

        var result = await _projectClient.Agents.CreateAgentVersionAsync(
            request.Name, options, cancellationToken);

        var agentVersion = result.Value;
        var promptDef = agentVersion.Definition as PromptAgentDefinition;

        _logger.LogInformation(
            "Created agent: {Name}, Version: {Version}",
            agentVersion.Name, agentVersion.Version);

        return new CreateAgentResponse
        {
            Name = agentVersion.Name ?? request.Name,
            Version = agentVersion.Version ?? "latest",
            Description = agentVersion.Description,
            Model = promptDef?.Model ?? request.Model,
            Instructions = promptDef?.Instructions ?? request.Instructions,
            CreatedAt = agentVersion.CreatedAt.ToUnixTimeSeconds(),
            Metadata = agentVersion.Metadata?.ToDictionary(kvp => kvp.Key, kvp => kvp.Value)
        };
    }

    /// <summary>
    /// List agents via the v2 Agents API.
    /// </summary>
    public async Task<AgentListResponse> ListAgentsAsync(
        int? limit = null,
        CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        _logger.LogInformation("Listing agents, limit: {Limit}", limit);

        var agents = new List<AgentListItem>();

        await foreach (var record in _projectClient.Agents.GetAgentsAsync(
            kind: null, limit: limit, order: null, after: null, before: null,
            cancellationToken: cancellationToken))
        {
            var latestVersion = record.Versions?.Latest;
            var definition = latestVersion?.Definition as PromptAgentDefinition;

            agents.Add(new AgentListItem
            {
                Name = record.Name ?? record.Id,
                Id = record.Id,
                Description = latestVersion?.Description,
                Model = definition?.Model ?? string.Empty,
                CreatedAt = latestVersion?.CreatedAt.ToUnixTimeSeconds() ?? 0
            });
        }

        _logger.LogInformation("Listed {Count} agents", agents.Count);

        return new AgentListResponse
        {
            Agents = agents,
            TotalCount = agents.Count
        };
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _disposed = true;
            _agentLock.Dispose();
            _logger.LogDebug("AgentFrameworkService disposed");
        }
    }
}

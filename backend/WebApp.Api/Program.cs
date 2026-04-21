using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Identity.Web;
using WebApp.Api.Models;
using WebApp.Api.Services;
using System.Security.Claims;

// Load .env file for local development BEFORE building the configuration
// In production (Docker), Container Apps injects environment variables directly
var envFilePath = Path.Combine(Directory.GetCurrentDirectory(), ".env");
if (File.Exists(envFilePath))
{
    foreach (var line in File.ReadAllLines(envFilePath))
    {
        if (string.IsNullOrWhiteSpace(line) || line.StartsWith("#"))
            continue;

        var parts = line.Split('=', 2, StringSplitOptions.TrimEntries);
        if (parts.Length == 2)
        {
            // Set as environment variables so they're picked up by configuration system
            Environment.SetEnvironmentVariable(parts[0], parts[1]);
        }
    }
}

var builder = WebApplication.CreateBuilder(args);

// Enable PII logging for debugging auth issues (ONLY IN DEVELOPMENT)
if (builder.Environment.IsDevelopment())
{
    Microsoft.IdentityModel.Logging.IdentityModelEventSource.ShowPII = true;
}

// Add ServiceDefaults (telemetry, health checks)
builder.AddServiceDefaults();

// Add ProblemDetails service for standardized RFC 7807 error responses
builder.Services.AddProblemDetails();

// Register IHttpContextAccessor for services that need access to the current HTTP request
builder.Services.AddHttpContextAccessor();

// Configure CORS for local development and production
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? new[] { "http://localhost:8080" };

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        // In development, allow any localhost port for flexibility
        if (builder.Environment.IsDevelopment())
        {
            policy.SetIsOriginAllowed(origin => 
            {
                if (Uri.TryCreate(origin, UriKind.Absolute, out var uri))
                {
                    return uri.Host == "localhost" || uri.Host == "127.0.0.1";
                }
                return false;
            })
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials();
        }
        else
        {
            policy.WithOrigins(allowedOrigins)
                  .AllowAnyMethod()
                  .AllowAnyHeader()
                  .AllowCredentials();
        }
    });
});

// Override ClientId and TenantId from environment variables if provided
// These will be set by azd during deployment or by AppHost in local dev
var clientId = builder.Configuration["ENTRA_SPA_CLIENT_ID"]
    ?? builder.Configuration["AzureAd:ClientId"];

if (!string.IsNullOrEmpty(clientId))
{
    builder.Configuration["AzureAd:ClientId"] = clientId;
    // Set audience to match the expected token audience claim
    builder.Configuration["AzureAd:Audience"] = $"api://{clientId}";
}

var tenantId = builder.Configuration["ENTRA_TENANT_ID"]
    ?? builder.Configuration["AzureAd:TenantId"];

if (!string.IsNullOrEmpty(tenantId))
{
    builder.Configuration["AzureAd:TenantId"] = tenantId;
}

const string RequiredScope = "Chat.ReadWrite";
const string ScopePolicyName = "RequireChatScope";

// Add Microsoft Identity Web authentication
// Validates JWT bearer tokens issued for the SPA's delegated scope
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(options =>
    {
        builder.Configuration.Bind("AzureAd", options);
        var configuredClientId = builder.Configuration["AzureAd:ClientId"];
        var backendClientId = builder.Configuration["ENTRA_BACKEND_CLIENT_ID"];

        // When OBO is enabled, tokens are scoped to the backend API app
        var audiences = new List<string> { configuredClientId!, $"api://{configuredClientId}" };
        if (!string.IsNullOrEmpty(backendClientId))
        {
            audiences.Add(backendClientId);
            audiences.Add($"api://{backendClientId}");
        }
        options.TokenValidationParameters.ValidAudiences = audiences;

        options.TokenValidationParameters.NameClaimType = ClaimTypes.Name;
        options.TokenValidationParameters.RoleClaimType = ClaimTypes.Role;
    }, options => builder.Configuration.Bind("AzureAd", options));

builder.Services.AddAuthorization(options =>
{
    // Use Microsoft.Identity.Web's built-in scope validation
    options.AddPolicy(ScopePolicyName, policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireScope(RequiredScope);
    });
});

// Register Foundry Agent Service (v2 Agents API)
// Uses Azure.AI.Projects SDK which works with v2 Agents API (/agents/ endpoint with human-readable IDs).
builder.Services.AddHttpClient();
builder.Services.AddScoped<AgentFrameworkService>();

var app = builder.Build();

// Add exception handling middleware for production
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler();
}

// Add status code pages for consistent error responses
app.UseStatusCodePages();

// Map health checks
app.MapDefaultEndpoints();

// Serve static files from wwwroot (frontend)
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors("AllowFrontend");

// Note: HTTPS redirection not needed - Azure Container Apps handles SSL termination at ingress
// The container receives HTTP traffic on port 8080

// Add authentication and authorization middleware
app.UseAuthentication();
app.UseAuthorization();

// Unauthenticated health endpoint for container probes
app.MapGet("/api/health", () => Results.Ok(new { status = "healthy" }))
.WithName("GetHealth");

// Streaming Chat endpoint: Streams agent response via SSE (conversationId → chunks → usage → done)
// Supports MCP tool approval flow with previousResponseId and mcpApproval parameters
app.MapPost("/api/chat/stream", async (
    ChatRequest request,
    AgentFrameworkService agentService,
    HttpContext httpContext,
    IHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    try
    {
        httpContext.Response.Headers.Append("Content-Type", "text/event-stream");
        httpContext.Response.Headers.Append("Cache-Control", "no-cache");
        httpContext.Response.Headers.Append("Connection", "keep-alive");

        var conversationId = request.ConversationId
            ?? await agentService.CreateConversationAsync(request.Message, cancellationToken);

        await WriteConversationIdEvent(httpContext.Response, conversationId, cancellationToken);

        var startTime = DateTime.UtcNow;

        await foreach (var chunk in agentService.StreamMessageAsync(
            conversationId,
            request.Message,
            request.ImageDataUris,
            request.FileDataUris,
            request.PreviousResponseId,
            request.McpApproval,
            cancellationToken))
        {
            if (chunk.IsText && chunk.TextDelta != null)
            {
                await WriteChunkEvent(httpContext.Response, chunk.TextDelta, cancellationToken);
            }
            else if (chunk.HasAnnotations && chunk.Annotations != null)
            {
                await WriteAnnotationsEvent(httpContext.Response, chunk.Annotations, cancellationToken);
            }
            else if (chunk.IsMcpApprovalRequest && chunk.McpApprovalRequest != null)
            {
                await WriteMcpApprovalRequestEvent(httpContext.Response, chunk.McpApprovalRequest, cancellationToken);
            }
            else if (chunk.IsToolUse && chunk.ToolName != null)
            {
                await WriteToolUseEvent(httpContext.Response, chunk.ToolName, cancellationToken);
            }
        }

        var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
        var usage = agentService.GetLastUsage();
        await WriteUsageEvent(
            httpContext.Response,
            duration,
            usage?.InputTokens ?? 0,
            usage?.OutputTokens ?? 0,
            usage?.TotalTokens ?? 0,
            cancellationToken);

        await WriteDoneEvent(httpContext.Response, cancellationToken);
    }
    catch (ArgumentException ex) when (ex.Message.Contains("Invalid") && (ex.Message.Contains("attachments") || ex.Message.Contains("image") || ex.Message.Contains("file")))
    {
        // Validation errors from image/file processing - return 400 Bad Request
        var errorResponse = ErrorResponseFactory.CreateFromException(
            ex, 
            400, 
            environment.IsDevelopment());
        
        await WriteErrorEvent(
            httpContext.Response, 
            errorResponse.Detail ?? errorResponse.Title, 
            cancellationToken);
    }
    catch (Exception ex)
    {
        var logger = httpContext.RequestServices.GetRequiredService<ILogger<Program>>();
        logger.LogError(ex, "Chat stream error: {Message}", ex.Message);
        
        var errorResponse = ErrorResponseFactory.CreateFromException(
            ex, 
            500, 
            environment.IsDevelopment());
        
        await WriteErrorEvent(
            httpContext.Response, 
            errorResponse.Detail ?? errorResponse.Title, 
            cancellationToken);
    }
})
.RequireAuthorization(ScopePolicyName)
.WithName("StreamChatMessage");

static async Task WriteConversationIdEvent(HttpResponse response, string conversationId, CancellationToken ct)
{
    var json = System.Text.Json.JsonSerializer.Serialize(new { type = "conversationId", conversationId });
    await response.WriteAsync($"data: {json}\n\n", ct);
    await response.Body.FlushAsync(ct);
}

static async Task WriteChunkEvent(HttpResponse response, string content, CancellationToken ct)
{
    var json = System.Text.Json.JsonSerializer.Serialize(new { type = "chunk", content });
    await response.WriteAsync($"data: {json}\n\n", ct);
    await response.Body.FlushAsync(ct);
}

static async Task WriteToolUseEvent(HttpResponse response, string toolName, CancellationToken ct)
{
    var json = System.Text.Json.JsonSerializer.Serialize(new { type = "toolUse", toolName });
    await response.WriteAsync($"data: {json}\n\n", ct);
    await response.Body.FlushAsync(ct);
}

static async Task WriteAnnotationsEvent(HttpResponse response, List<WebApp.Api.Models.AnnotationInfo> annotations, CancellationToken ct)
{
    var json = System.Text.Json.JsonSerializer.Serialize(new
    {
        type = "annotations",
        annotations = annotations.Select(a => new
        {
            type = a.Type,
            label = a.Label,
            url = a.Url,
            fileId = a.FileId,
            containerId = a.ContainerId,
            textToReplace = a.TextToReplace,
            startIndex = a.StartIndex,
            endIndex = a.EndIndex,
            quote = a.Quote
        })
    });
    await response.WriteAsync($"data: {json}\n\n", ct);
    await response.Body.FlushAsync(ct);
}

static async Task WriteMcpApprovalRequestEvent(HttpResponse response, WebApp.Api.Models.McpApprovalRequest approval, CancellationToken ct)
{
    var json = System.Text.Json.JsonSerializer.Serialize(new
    {
        type = "mcpApprovalRequest",
        approvalRequest = new
        {
            id = approval.Id,
            toolName = approval.ToolName,
            serverLabel = approval.ServerLabel,
            arguments = approval.Arguments,
            previousResponseId = approval.PreviousResponseId
        }
    });
    await response.WriteAsync($"data: {json}\n\n", ct);
    await response.Body.FlushAsync(ct);
}

static async Task WriteUsageEvent(HttpResponse response, double duration, int promptTokens, int completionTokens, int totalTokens, CancellationToken ct)
{
    var json = System.Text.Json.JsonSerializer.Serialize(new
    {
        type = "usage",
        duration,
        promptTokens,
        completionTokens,
        totalTokens
    });
    await response.WriteAsync($"data: {json}\n\n", ct);
    await response.Body.FlushAsync(ct);
}

static async Task WriteDoneEvent(HttpResponse response, CancellationToken ct)
{
    await response.WriteAsync("data: {\"type\":\"done\"}\n\n", ct);
    await response.Body.FlushAsync(ct);
}

static async Task WriteErrorEvent(HttpResponse response, string message, CancellationToken ct)
{
    var json = System.Text.Json.JsonSerializer.Serialize(new { type = "error", message });
    await response.WriteAsync($"data: {json}\n\n", ct);
    await response.Body.FlushAsync(ct);
}

// Get agent metadata (name, description, model, metadata)
// Used by frontend to display agent information in the UI
app.MapGet("/api/agent", async (
    AgentFrameworkService agentService,
    IHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    try
    {
        var metadata = await agentService.GetAgentMetadataAsync(cancellationToken);
        return Results.Ok(metadata);
    }
    catch (Exception ex)
    {
        var errorResponse = ErrorResponseFactory.CreateFromException(
            ex, 
            500, 
            environment.IsDevelopment());
        
        return Results.Problem(
            title: errorResponse.Title,
            detail: errorResponse.Detail,
            statusCode: errorResponse.Status,
            extensions: errorResponse.Extensions
        );
    }
})
.RequireAuthorization(ScopePolicyName)
.WithName("GetAgentMetadata");

// Get agent info (for debugging)
app.MapGet("/api/agent/info", async (
    AgentFrameworkService agentService,
    IHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    try
    {
        var agentInfo = await agentService.GetAgentInfoAsync(cancellationToken);
        return Results.Ok(new
        {
            info = agentInfo,
            status = "ready"
        });
    }
    catch (Exception ex)
    {
        var errorResponse = ErrorResponseFactory.CreateFromException(
            ex, 
            500, 
            environment.IsDevelopment());
        
        return Results.Problem(
            title: errorResponse.Title,
            detail: errorResponse.Detail,
            statusCode: errorResponse.Status,
            extensions: errorResponse.Extensions
        );
    }
})
.RequireAuthorization(ScopePolicyName)
.WithName("GetAgentInfo");

// List conversations
app.MapGet("/api/conversations", async (
    AgentFrameworkService agentService,
    IHostEnvironment environment,
    int? limit,
    CancellationToken cancellationToken) =>
{
    // MI mode: conversations are agent-scoped, not user-scoped.
    // All authenticated users see all conversations for this agent.
    // This is by-design — OBO mode (ENTRA_BACKEND_CLIENT_ID set) scopes per-user.
    try
    {
        var pageSize = Math.Clamp(limit ?? 20, 1, 100);
        var conversations = await agentService.ListConversationsAsync(pageSize, cancellationToken);
        var hasMore = conversations.Count > pageSize;
        if (hasMore)
            conversations = conversations.Take(pageSize).ToList();
        return Results.Ok(new { conversations, hasMore });
    }
    catch (Exception ex)
    {
        var errorResponse = ErrorResponseFactory.CreateFromException(ex, 500, environment.IsDevelopment());
        return Results.Problem(
            title: errorResponse.Title,
            detail: errorResponse.Detail,
            statusCode: errorResponse.Status,
            extensions: errorResponse.Extensions
        );
    }
})
.RequireAuthorization(ScopePolicyName)
.WithName("ListConversations");

// Get conversation messages
app.MapGet("/api/conversations/{conversationId}/messages", async (
    string conversationId,
    AgentFrameworkService agentService,
    IHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    try
    {
        var messages = await agentService.GetConversationMessagesAsync(conversationId, cancellationToken);
        return Results.Ok(messages);
    }
    catch (Exception ex)
    {
        var errorResponse = ErrorResponseFactory.CreateFromException(ex, 500, environment.IsDevelopment());
        return Results.Problem(
            title: errorResponse.Title,
            detail: errorResponse.Detail,
            statusCode: errorResponse.Status,
            extensions: errorResponse.Extensions
        );
    }
})
.RequireAuthorization(ScopePolicyName)
.WithName("GetConversationMessages");

// Delete conversation
app.MapDelete("/api/conversations/{conversationId}", async (
    string conversationId,
    AgentFrameworkService agentService,
    IHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    try
    {
        await agentService.DeleteConversationAsync(conversationId, cancellationToken);
        return Results.NoContent();
    }
    catch (NotSupportedException)
    {
        return Results.Problem(
            title: "Not Implemented",
            detail: "Conversation deletion is not yet supported by the Azure.AI.Projects SDK.",
            statusCode: 501
        );
    }
    catch (Exception ex)
    {
        var errorResponse = ErrorResponseFactory.CreateFromException(ex, 500, environment.IsDevelopment());
        return Results.Problem(
            title: errorResponse.Title,
            detail: errorResponse.Detail,
            statusCode: errorResponse.Status,
            extensions: errorResponse.Extensions
        );
    }
})
.RequireAuthorization(ScopePolicyName)
.WithName("DeleteConversation");

// File download endpoint for code interpreter outputs
app.MapGet("/api/files/{fileId}", async (
    string fileId,
    string? containerId,
    AgentFrameworkService agentService,
    IHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    try
    {
        var (content, fileName) = await agentService.DownloadFileAsync(fileId, containerId, cancellationToken);
        var contentType = GetMimeType(fileName);
        return Results.File(content.ToArray(), contentType, fileName);
    }
    catch (HttpRequestException httpEx)
    {
        var statusCode = (int?)httpEx.StatusCode ?? 502;
        var errorResponse = ErrorResponseFactory.CreateFromException(httpEx, statusCode, environment.IsDevelopment());
        return Results.Problem(
            title: errorResponse.Title,
            detail: errorResponse.Detail,
            statusCode: errorResponse.Status,
            extensions: errorResponse.Extensions
        );
    }
    catch (Exception ex)
    {
        var errorResponse = ErrorResponseFactory.CreateFromException(ex, 500, environment.IsDevelopment());
        return Results.Problem(
            title: errorResponse.Title,
            detail: errorResponse.Detail,
            statusCode: errorResponse.Status,
            extensions: errorResponse.Extensions
        );
    }
})
.RequireAuthorization(ScopePolicyName)
.WithName("DownloadFile");

// Uploaded-files cleanup endpoints — inspect & delete image files previously uploaded by
// this web app. Uses the WebAppUploadFilenamePrefix tag applied on upload to scope the
// operation to our own files, because the Foundry Files API does not expose a typed
// expires_after parameter in the GA SDK (see README "Known limitations").
app.MapGet("/api/files/uploaded", async (
    AgentFrameworkService agentService,
    IHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    try
    {
        var info = await agentService.ListUploadedFilesAsync(cancellationToken);
        return Results.Ok(info);
    }
    catch (Exception ex)
    {
        var errorResponse = ErrorResponseFactory.CreateFromException(ex, 500, environment.IsDevelopment());
        return Results.Problem(
            title: errorResponse.Title,
            detail: errorResponse.Detail,
            statusCode: errorResponse.Status,
            extensions: errorResponse.Extensions
        );
    }
})
.RequireAuthorization(ScopePolicyName)
.WithName("ListUploadedFiles");

app.MapPost("/api/files/cleanup", async (
    AgentFrameworkService agentService,
    IHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    try
    {
        var result = await agentService.CleanupUploadedFilesAsync(cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception ex)
    {
        var errorResponse = ErrorResponseFactory.CreateFromException(ex, 500, environment.IsDevelopment());
        return Results.Problem(
            title: errorResponse.Title,
            detail: errorResponse.Detail,
            statusCode: errorResponse.Status,
            extensions: errorResponse.Extensions
        );
    }
})
.RequireAuthorization(ScopePolicyName)
.WithName("CleanupUploadedFiles");

// Fallback route for SPA - serve index.html for any non-API routes
app.MapFallbackToFile("index.html");

app.Run();

// Helper to determine MIME type from file extension
static string GetMimeType(string fileName)
{
    var ext = Path.GetExtension(fileName).ToLowerInvariant();
    return ext switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".svg" => "image/svg+xml",
        ".pdf" => "application/pdf",
        ".csv" => "text/csv",
        ".json" => "application/json",
        ".txt" => "text/plain",
        ".md" => "text/markdown",
        ".html" => "text/html",
        ".py" => "text/x-python",
        ".js" => "text/javascript",
        _ => "application/octet-stream",
    };
}

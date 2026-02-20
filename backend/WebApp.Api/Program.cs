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

        options.TokenValidationParameters.ValidAudiences = new[]
        {
            configuredClientId,
            $"api://{configuredClientId}"
        };

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

// Register Azure AI Agent Service for Azure AI Foundry v2 Agents
// Uses Azure.AI.Projects SDK which works with v2 Agents API (/agents/ endpoint with human-readable IDs).
builder.Services.AddScoped<AgentFrameworkService>();
builder.Services.AddScoped<IAgentCrudService>(sp => sp.GetRequiredService<AgentFrameworkService>());

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

// Authenticated health endpoint exposes caller identity
app.MapGet("/api/health", (HttpContext context) =>
{
    var userId = context.User.FindFirst("oid")?.Value ?? "unknown";
    var userName = context.User.FindFirst("name")?.Value ?? "unknown";

    return Results.Ok(new
    {
        status = "healthy",
        timestamp = DateTime.UtcNow,
        authenticated = true,
        user = new { id = userId, name = userName }
    });
})
.RequireAuthorization(ScopePolicyName)
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
            request.AgentId,
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
    await response.WriteAsync(
        $"data: {{\"type\":\"conversationId\",\"conversationId\":\"{conversationId}\"}}\n\n",
        ct);
    await response.Body.FlushAsync(ct);
}

static async Task WriteChunkEvent(HttpResponse response, string content, CancellationToken ct)
{
    var json = System.Text.Json.JsonSerializer.Serialize(new { type = "chunk", content });
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
            arguments = approval.Arguments
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

// Create a new agent
app.MapPost("/api/agents", async (
    CreateAgentRequest request,
    IAgentCrudService agentCrudService,
    IHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    try
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return Results.Problem(title: "Invalid Request", detail: "Name is required.", statusCode: 400);
        if (string.IsNullOrWhiteSpace(request.Model))
            return Results.Problem(title: "Invalid Request", detail: "Model is required.", statusCode: 400);
        if (string.IsNullOrWhiteSpace(request.Instructions))
            return Results.Problem(title: "Invalid Request", detail: "Instructions are required.", statusCode: 400);

        var response = await agentCrudService.CreateAgentAsync(request, cancellationToken);
        return Results.Created($"/api/agents/{response.Name}", response);
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
.WithName("CreateAgent");

// List agents
app.MapGet("/api/agents", async (
    int? limit,
    IAgentCrudService agentCrudService,
    IHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    try
    {
        var response = await agentCrudService.ListAgentsAsync(limit, cancellationToken);
        return Results.Ok(response);
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
.WithName("ListAgents");

// Fallback route for SPA - serve index.html for any non-API routes
app.MapFallbackToFile("index.html");

app.Run();

// Make Program accessible to WebApplicationFactory in test project
public partial class Program { }

namespace WebApp.Api.Models;

public record ChatRequest
{
    public required string Message { get; init; }
    public string? ConversationId { get; init; }
    /// <summary>
    /// Base64-encoded image data URIs (e.g., data:image/png;base64,iVBORw0KG...)
    /// Images are sent inline with the message, no file upload needed.
    /// </summary>
    public List<string>? ImageDataUris { get; init; }
    /// <summary>
    /// File attachments with metadata (filename, MIME type, base64 data).
    /// Supports documents like PDF, DOCX, TXT, etc.
    /// </summary>
    public List<FileAttachment>? FileDataUris { get; init; }
    /// <summary>
    /// MCP tool approval response (for resuming after approval request).
    /// </summary>
    public McpApprovalResponse? McpApproval { get; init; }
    /// <summary>
    /// Response ID to continue from (for MCP approval flow).
    /// </summary>
    public string? PreviousResponseId { get; init; }
    /// <summary>
    /// Optional agent ID to use instead of the default configured agent.
    /// </summary>
    public string? AgentId { get; init; }
}

/// <summary>
/// Represents a user's approval/rejection decision for an MCP tool call.
/// </summary>
public record McpApprovalResponse
{
    public required string ApprovalRequestId { get; init; }
    public required bool Approved { get; init; }
}

/// <summary>
/// Represents a file attachment with metadata for document upload.
/// </summary>
public record FileAttachment
{
    /// <summary>
    /// Base64 data URI (e.g., data:application/pdf;base64,...)
    /// </summary>
    public required string DataUri { get; init; }
    /// <summary>
    /// Original filename with extension
    /// </summary>
    public required string FileName { get; init; }
    /// <summary>
    /// MIME type (e.g., application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document)
    /// </summary>
    public required string MimeType { get; init; }
}

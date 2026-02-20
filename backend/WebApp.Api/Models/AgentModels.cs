namespace WebApp.Api.Models;

public record CreateAgentRequest
{
    public required string Name { get; init; }
    public required string Model { get; init; }
    public required string Instructions { get; init; }
    public string? Description { get; init; }
    public Dictionary<string, string>? Metadata { get; init; }
    public float? Temperature { get; init; }
    public float? TopP { get; init; }
}

public record CreateAgentResponse
{
    public required string Name { get; init; }
    public required string Version { get; init; }
    public string? Description { get; init; }
    public required string Model { get; init; }
    public required string Instructions { get; init; }
    public required long CreatedAt { get; init; }
    public Dictionary<string, string>? Metadata { get; init; }
}

public record AgentListItem
{
    public required string Name { get; init; }
    public required string Id { get; init; }
    public string? Description { get; init; }
    public required string Model { get; init; }
    public required long CreatedAt { get; init; }
}

public record AgentListResponse
{
    public required List<AgentListItem> Agents { get; init; }
    public required int TotalCount { get; init; }
}

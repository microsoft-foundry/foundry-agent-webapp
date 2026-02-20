using System.Text.Json;
using WebApp.Api.Models;

namespace WebApp.Api.Tests.Models;

public class AgentModelsTests
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    // -- CreateAgentRequest --

    [Fact]
    public void CreateAgentRequest_DeserializesFromJson()
    {
        var json = """
        {
            "name": "test-agent",
            "model": "gpt-4o",
            "instructions": "You are a test.",
            "description": "A test agent",
            "temperature": 0.7,
            "topP": 0.9,
            "metadata": { "env": "test" }
        }
        """;

        var request = JsonSerializer.Deserialize<CreateAgentRequest>(json, JsonOptions);

        Assert.NotNull(request);
        Assert.Equal("test-agent", request.Name);
        Assert.Equal("gpt-4o", request.Model);
        Assert.Equal("You are a test.", request.Instructions);
        Assert.Equal("A test agent", request.Description);
        Assert.Equal(0.7f, request.Temperature);
        Assert.Equal(0.9f, request.TopP);
        Assert.NotNull(request.Metadata);
        Assert.Equal("test", request.Metadata["env"]);
    }

    [Fact]
    public void CreateAgentRequest_DeserializesMinimalJson()
    {
        var json = """
        {
            "name": "minimal",
            "model": "gpt-4o",
            "instructions": "Be helpful."
        }
        """;

        var request = JsonSerializer.Deserialize<CreateAgentRequest>(json, JsonOptions);

        Assert.NotNull(request);
        Assert.Equal("minimal", request.Name);
        Assert.Null(request.Description);
        Assert.Null(request.Temperature);
        Assert.Null(request.TopP);
        Assert.Null(request.Metadata);
    }

    [Fact]
    public void CreateAgentRequest_RoundTrips()
    {
        var original = new CreateAgentRequest
        {
            Name = "roundtrip",
            Model = "gpt-4o",
            Instructions = "Test instructions",
            Description = "Test desc",
            Temperature = 0.5f,
            TopP = 0.8f,
            Metadata = new Dictionary<string, string> { ["key"] = "value" }
        };

        var json = JsonSerializer.Serialize(original, JsonOptions);
        var deserialized = JsonSerializer.Deserialize<CreateAgentRequest>(json, JsonOptions);

        Assert.NotNull(deserialized);
        Assert.Equal(original.Name, deserialized.Name);
        Assert.Equal(original.Model, deserialized.Model);
        Assert.Equal(original.Instructions, deserialized.Instructions);
        Assert.Equal(original.Description, deserialized.Description);
        Assert.Equal(original.Temperature, deserialized.Temperature);
        Assert.Equal(original.TopP, deserialized.TopP);
        Assert.Equal(original.Metadata["key"], deserialized.Metadata!["key"]);
    }

    // -- CreateAgentResponse --

    [Fact]
    public void CreateAgentResponse_SerializesToJson()
    {
        var response = new CreateAgentResponse
        {
            Name = "my-agent",
            Version = "1.0",
            Description = "desc",
            Model = "gpt-4o",
            Instructions = "Be helpful.",
            CreatedAt = 1700000000,
            Metadata = new Dictionary<string, string> { ["key"] = "val" }
        };

        var json = JsonSerializer.Serialize(response, JsonOptions);
        var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal("my-agent", root.GetProperty("name").GetString());
        Assert.Equal("1.0", root.GetProperty("version").GetString());
        Assert.Equal("desc", root.GetProperty("description").GetString());
        Assert.Equal("gpt-4o", root.GetProperty("model").GetString());
        Assert.Equal("Be helpful.", root.GetProperty("instructions").GetString());
        Assert.Equal(1700000000, root.GetProperty("createdAt").GetInt64());
        Assert.Equal("val", root.GetProperty("metadata").GetProperty("key").GetString());
    }

    [Fact]
    public void CreateAgentResponse_NullableFieldsOmittedWhenNull()
    {
        var response = new CreateAgentResponse
        {
            Name = "agent",
            Version = "latest",
            Model = "gpt-4o",
            Instructions = "test",
            CreatedAt = 0
        };

        var json = JsonSerializer.Serialize(response, JsonOptions);
        var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.True(root.TryGetProperty("description", out var desc));
        Assert.Equal(JsonValueKind.Null, desc.ValueKind);
        Assert.True(root.TryGetProperty("metadata", out var meta));
        Assert.Equal(JsonValueKind.Null, meta.ValueKind);
    }

    // -- AgentListItem --

    [Fact]
    public void AgentListItem_SerializesToJson()
    {
        var item = new AgentListItem
        {
            Name = "agent-1",
            Id = "abc123",
            Description = "First agent",
            Model = "gpt-4o",
            CreatedAt = 1700000000
        };

        var json = JsonSerializer.Serialize(item, JsonOptions);
        var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal("agent-1", root.GetProperty("name").GetString());
        Assert.Equal("abc123", root.GetProperty("id").GetString());
        Assert.Equal("First agent", root.GetProperty("description").GetString());
        Assert.Equal("gpt-4o", root.GetProperty("model").GetString());
        Assert.Equal(1700000000, root.GetProperty("createdAt").GetInt64());
    }

    // -- AgentListResponse --

    [Fact]
    public void AgentListResponse_SerializesToJson()
    {
        var response = new AgentListResponse
        {
            Agents = new List<AgentListItem>
            {
                new() { Name = "a1", Id = "1", Model = "gpt-4o", CreatedAt = 100 },
                new() { Name = "a2", Id = "2", Model = "gpt-4o-mini", CreatedAt = 200 }
            },
            TotalCount = 2
        };

        var json = JsonSerializer.Serialize(response, JsonOptions);
        var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal(2, root.GetProperty("totalCount").GetInt32());
        Assert.Equal(2, root.GetProperty("agents").GetArrayLength());
        Assert.Equal("a1", root.GetProperty("agents")[0].GetProperty("name").GetString());
        Assert.Equal("a2", root.GetProperty("agents")[1].GetProperty("name").GetString());
    }

    [Fact]
    public void AgentListResponse_EmptyList()
    {
        var response = new AgentListResponse
        {
            Agents = new List<AgentListItem>(),
            TotalCount = 0
        };

        var json = JsonSerializer.Serialize(response, JsonOptions);
        var doc = JsonDocument.Parse(json);

        Assert.Equal(0, doc.RootElement.GetProperty("totalCount").GetInt32());
        Assert.Equal(0, doc.RootElement.GetProperty("agents").GetArrayLength());
    }
}

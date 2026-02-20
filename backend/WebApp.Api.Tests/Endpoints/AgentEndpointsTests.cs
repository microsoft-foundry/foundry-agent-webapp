using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Moq;
using WebApp.Api.Models;

namespace WebApp.Api.Tests.Endpoints;

public class CreateAgentEndpointTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly HttpClient _client;
    private readonly Mock<Services.IAgentCrudService> _mockService;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public CreateAgentEndpointTests(TestWebApplicationFactory factory)
    {
        _mockService = factory.MockAgentCrudService;
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task CreateAgent_ValidRequest_Returns201()
    {
        var request = new CreateAgentRequest
        {
            Name = "test-agent",
            Model = "gpt-4o",
            Instructions = "You are a helpful assistant."
        };

        var expectedResponse = new CreateAgentResponse
        {
            Name = "test-agent",
            Version = "1.0",
            Description = null,
            Model = "gpt-4o",
            Instructions = "You are a helpful assistant.",
            CreatedAt = 1700000000
        };

        _mockService.Setup(s => s.CreateAgentAsync(
                It.Is<CreateAgentRequest>(r => r.Name == "test-agent"),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(expectedResponse);

        var response = await _client.PostAsJsonAsync("/api/agents", request, JsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("/api/agents/test-agent", response.Headers.Location?.OriginalString);

        var body = await response.Content.ReadFromJsonAsync<CreateAgentResponse>(JsonOptions);
        Assert.NotNull(body);
        Assert.Equal("test-agent", body.Name);
        Assert.Equal("1.0", body.Version);
        Assert.Equal("gpt-4o", body.Model);
    }

    [Fact]
    public async Task CreateAgent_WithAllFields_Returns201()
    {
        var request = new CreateAgentRequest
        {
            Name = "full-agent",
            Model = "gpt-4o",
            Instructions = "You are helpful.",
            Description = "Full test agent",
            Temperature = 0.7f,
            TopP = 0.9f,
            Metadata = new Dictionary<string, string> { ["env"] = "test" }
        };

        var expectedResponse = new CreateAgentResponse
        {
            Name = "full-agent",
            Version = "1.0",
            Description = "Full test agent",
            Model = "gpt-4o",
            Instructions = "You are helpful.",
            CreatedAt = 1700000000,
            Metadata = new Dictionary<string, string> { ["env"] = "test" }
        };

        _mockService.Setup(s => s.CreateAgentAsync(
                It.Is<CreateAgentRequest>(r => r.Name == "full-agent" && r.Temperature == 0.7f),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(expectedResponse);

        var response = await _client.PostAsJsonAsync("/api/agents", request, JsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<CreateAgentResponse>(JsonOptions);
        Assert.NotNull(body);
        Assert.Equal("Full test agent", body.Description);
        Assert.Equal(1700000000, body.CreatedAt);
        Assert.NotNull(body.Metadata);
        Assert.Equal("test", body.Metadata["env"]);
    }

    [Fact]
    public async Task CreateAgent_EmptyName_Returns400()
    {
        var request = new CreateAgentRequest
        {
            Name = "",
            Model = "gpt-4o",
            Instructions = "test"
        };

        var response = await _client.PostAsJsonAsync("/api/agents", request, JsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Name is required", body);
    }

    [Fact]
    public async Task CreateAgent_WhitespaceName_Returns400()
    {
        var request = new CreateAgentRequest
        {
            Name = "   ",
            Model = "gpt-4o",
            Instructions = "test"
        };

        var response = await _client.PostAsJsonAsync("/api/agents", request, JsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateAgent_EmptyModel_Returns400()
    {
        var request = new CreateAgentRequest
        {
            Name = "test",
            Model = "",
            Instructions = "test"
        };

        var response = await _client.PostAsJsonAsync("/api/agents", request, JsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Model is required", body);
    }

    [Fact]
    public async Task CreateAgent_EmptyInstructions_Returns400()
    {
        var request = new CreateAgentRequest
        {
            Name = "test",
            Model = "gpt-4o",
            Instructions = ""
        };

        var response = await _client.PostAsJsonAsync("/api/agents", request, JsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Instructions are required", body);
    }

    [Fact]
    public async Task CreateAgent_ServiceThrows_Returns500()
    {
        var request = new CreateAgentRequest
        {
            Name = "error-agent",
            Model = "gpt-4o",
            Instructions = "test"
        };

        _mockService.Setup(s => s.CreateAgentAsync(
                It.Is<CreateAgentRequest>(r => r.Name == "error-agent"),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Azure SDK error"));

        var response = await _client.PostAsJsonAsync("/api/agents", request, JsonOptions);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
    }
}

public class ListAgentsEndpointTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly HttpClient _client;
    private readonly Mock<Services.IAgentCrudService> _mockService;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public ListAgentsEndpointTests(TestWebApplicationFactory factory)
    {
        _mockService = factory.MockAgentCrudService;
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task ListAgents_ReturnsAgents()
    {
        var expectedResponse = new AgentListResponse
        {
            Agents = new List<AgentListItem>
            {
                new() { Name = "agent-1", Id = "id1", Model = "gpt-4o", CreatedAt = 100, Description = "First" },
                new() { Name = "agent-2", Id = "id2", Model = "gpt-4o-mini", CreatedAt = 200 }
            },
            TotalCount = 2
        };

        _mockService.Setup(s => s.ListAgentsAsync(
                null,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(expectedResponse);

        var response = await _client.GetAsync("/api/agents");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<AgentListResponse>(JsonOptions);
        Assert.NotNull(body);
        Assert.Equal(2, body.TotalCount);
        Assert.Equal(2, body.Agents.Count);
        Assert.Equal("agent-1", body.Agents[0].Name);
        Assert.Equal("agent-2", body.Agents[1].Name);
    }

    [Fact]
    public async Task ListAgents_WithLimit_PassesLimitToService()
    {
        var expectedResponse = new AgentListResponse
        {
            Agents = new List<AgentListItem>
            {
                new() { Name = "agent-1", Id = "id1", Model = "gpt-4o", CreatedAt = 100 }
            },
            TotalCount = 1
        };

        _mockService.Setup(s => s.ListAgentsAsync(
                5,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(expectedResponse);

        var response = await _client.GetAsync("/api/agents?limit=5");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<AgentListResponse>(JsonOptions);
        Assert.NotNull(body);
        Assert.Single(body.Agents);
    }

    [Fact]
    public async Task ListAgents_EmptyResult_ReturnsEmptyList()
    {
        var expectedResponse = new AgentListResponse
        {
            Agents = new List<AgentListItem>(),
            TotalCount = 0
        };

        _mockService.Setup(s => s.ListAgentsAsync(
                It.IsAny<int?>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(expectedResponse);

        var response = await _client.GetAsync("/api/agents");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<AgentListResponse>(JsonOptions);
        Assert.NotNull(body);
        Assert.Empty(body.Agents);
        Assert.Equal(0, body.TotalCount);
    }

    [Fact]
    public async Task ListAgents_ServiceThrows_Returns500()
    {
        _mockService.Setup(s => s.ListAgentsAsync(
                It.IsAny<int?>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Connection failed"));

        var response = await _client.GetAsync("/api/agents");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
    }
}

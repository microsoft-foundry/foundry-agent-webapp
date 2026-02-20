using WebApp.Api.Models;

namespace WebApp.Api.Services;

/// <summary>
/// Interface for agent CRUD operations, enabling testability of endpoints.
/// </summary>
public interface IAgentCrudService
{
    Task<CreateAgentResponse> CreateAgentAsync(CreateAgentRequest request, CancellationToken cancellationToken = default);
    Task<AgentListResponse> ListAgentsAsync(int? limit = null, CancellationToken cancellationToken = default);
}

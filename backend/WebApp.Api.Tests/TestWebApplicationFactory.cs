using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Moq;
using WebApp.Api.Services;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace WebApp.Api.Tests;

/// <summary>
/// Custom WebApplicationFactory that:
/// - Provides fake Azure config so the app can start
/// - Replaces IAgentCrudService with a mock
/// - Uses a fake auth handler to bypass Entra ID
/// </summary>
public class TestWebApplicationFactory : WebApplicationFactory<Program>
{
    public Mock<IAgentCrudService> MockAgentCrudService { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        // Provide fake config values so AgentFrameworkService constructor doesn't throw
        // during DI registration (it's still registered but we override the interface)
        Environment.SetEnvironmentVariable("AI_AGENT_ENDPOINT", "https://fake-test-endpoint.openai.azure.com");
        Environment.SetEnvironmentVariable("AI_AGENT_ID", "fake-test-agent");
        Environment.SetEnvironmentVariable("ENTRA_SPA_CLIENT_ID", "00000000-0000-0000-0000-000000000000");
        Environment.SetEnvironmentVariable("ENTRA_TENANT_ID", "00000000-0000-0000-0000-000000000001");

        builder.ConfigureServices(services =>
        {
            // Replace IAgentCrudService with our mock
            services.RemoveAll<IAgentCrudService>();
            services.AddScoped(_ => MockAgentCrudService.Object);

            // Replace authentication with a fake handler that always succeeds
            services.AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, FakeAuthHandler>("Test", _ => { });

            // Override default auth scheme
            services.PostConfigure<AuthenticationOptions>(options =>
            {
                options.DefaultAuthenticateScheme = "Test";
                options.DefaultChallengeScheme = "Test";
            });
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            Environment.SetEnvironmentVariable("AI_AGENT_ENDPOINT", null);
            Environment.SetEnvironmentVariable("AI_AGENT_ID", null);
            Environment.SetEnvironmentVariable("ENTRA_SPA_CLIENT_ID", null);
            Environment.SetEnvironmentVariable("ENTRA_TENANT_ID", null);
        }
    }
}

/// <summary>
/// Fake authentication handler that issues a token with the required Chat.ReadWrite scope.
/// </summary>
public class FakeAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public FakeAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder) { }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var claims = new[]
        {
            new Claim("oid", "test-user-id"),
            new Claim("name", "Test User"),
            new Claim("http://schemas.microsoft.com/identity/claims/scope", "Chat.ReadWrite"),
        };

        var identity = new ClaimsIdentity(claims, "Test");
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, "Test");

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}

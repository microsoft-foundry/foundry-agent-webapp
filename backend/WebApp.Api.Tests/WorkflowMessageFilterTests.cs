using System.ClientModel.Primitives;
using Azure.AI.Extensions.OpenAI;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using OpenAI.Responses;
using WebApp.Api.Models;
using WebApp.Api.Services;

namespace WebApp.Api.Tests;

#pragma warning disable OPENAI001

/// <summary>
/// Workflow agents stream and store every inner agent's output alongside the workflow's own
/// reply. These tests lock down how the backend tells them apart, using payload shapes
/// captured from a live Foundry workflow run.
/// </summary>
[TestClass]
public class WorkflowMessageFilterTests
{
    private const string Workflow = "Kisan-Orchestrator";

    [TestMethod]
    public void ProducingAgent_ReadsAgentReference_FromStreamedItem()
    {
        var item = ModelReaderWriter.Read<ResponseItem>(BinaryData.FromString("""
            {"type":"message","id":"msg_1","role":"assistant","status":"in_progress","content":[],
             "agent_reference":{"type":"agent_reference","name":"Router","version":"9"},
             "response_id":"resp_1"}
            """))!;

        Assert.AreEqual("Router", AgentFrameworkService.GetProducingAgentName(item));
    }

    [TestMethod]
    public void ProducingAgent_ReadsCreatedBy_FromStoredItem()
    {
        var item = ModelReaderWriter.Read<AgentResponseItem>(BinaryData.FromString("""
            {"type":"message","id":"msg_2","role":"assistant","status":"completed",
             "content":[{"type":"output_text","text":"Final answer","annotations":[]}],
             "created_by":{"agent":{"type":"agent_id","name":"Kisan-Orchestrator","version":"19"},"response_id":"wfresp_1"}}
            """))!;

        Assert.AreEqual(Workflow, AgentFrameworkService.GetProducingAgentName(item));
    }

    [TestMethod]
    public void ProducingAgent_IsNull_ForUntaggedUserMessage()
    {
        var item = ModelReaderWriter.Read<AgentResponseItem>(BinaryData.FromString("""
            {"type":"message","id":"msg_3","role":"user","status":"completed",
             "content":[{"type":"input_text","text":"How to control aphids?"}]}
            """))!;

        Assert.IsNull(AgentFrameworkService.GetProducingAgentName(item));
    }

    [TestMethod]
    public void History_KeepsQuestionAndWorkflowReplyOnly()
    {
        // Order and tags as stored by a Router → specialist → product workflow run.
        var stored = new (ConversationMessageInfo, string?)[]
        {
            (Msg("user", "How to control aphids?"), null),
            (Msg("user", "How to control aphids?"), null),
            (Msg("assistant", """{"route":"apple"}"""), "Router"),
            (Msg("user", "How to control aphids?"), null),
            (Msg("assistant", """{"status":"DIAGNOSED"}"""), "protect-prevent"),
            (Msg("user", "Aphids Filprid"), null),
            (Msg("assistant", """{"has_recommendation":true}"""), "product-recommendation-agent"),
            (Msg("assistant", "Final answer"), Workflow),
            (Msg("user", "What about mites?"), null),
            (Msg("user", "What about mites?"), null),
            (Msg("assistant", "Second answer"), Workflow),
        };

        var result = AgentFrameworkService.FilterWorkflowHistory(stored, Workflow);

        CollectionAssert.AreEqual(
            new[] { "user:How to control aphids?", "assistant:Final answer", "user:What about mites?", "assistant:Second answer" },
            result.Select(m => $"{m.Role}:{m.Content}").ToArray());
    }

    private static ConversationMessageInfo Msg(string role, string content) => new() { Role = role, Content = content };
}

using Microsoft.VisualStudio.TestTools.UnitTesting;
using WebApp.Api.Services;

namespace WebApp.Api.Tests;

/// <summary>
/// Verifies the filename-prefix convention used by the uploaded-files cleanup feature.
/// The cleanup endpoint scopes deletes by matching this prefix on the stored filename;
/// any regression in the constant or the matcher would cause the UI to either miss our
/// files or delete unrelated files in the shared Foundry project.
/// </summary>
[TestClass]
public class UploadedFilesPrefixTests
{
    [TestMethod]
    public void Prefix_IsStableValue()
    {
        // Locked by contract: changing this value would orphan every file already uploaded
        // by a previous build, because the cleanup matcher would no longer recognize them.
        Assert.AreEqual("webapp-upload-", AgentFrameworkService.WebAppUploadFilenamePrefix);
    }

    [TestMethod]
    public void PrefixMatch_AcceptsWebAppUpload()
    {
        var name = $"{AgentFrameworkService.WebAppUploadFilenamePrefix}abc123.png";
        Assert.IsTrue(name.StartsWith(AgentFrameworkService.WebAppUploadFilenamePrefix, StringComparison.Ordinal));
    }

    [TestMethod]
    public void PrefixMatch_RejectsForeignFile()
    {
        // A file uploaded by some other tool/user in the shared Foundry project must not match.
        var name = "dataset-2025-training.png";
        Assert.IsFalse(name.StartsWith(AgentFrameworkService.WebAppUploadFilenamePrefix, StringComparison.Ordinal));
    }

    [TestMethod]
    public void PrefixMatch_RejectsLegacyName()
    {
        // Pre-cleanup builds used "image-{guid}" — legacy uploads are intentionally left alone
        // because we cannot prove they were ours.
        var name = "image-abc123.png";
        Assert.IsFalse(name.StartsWith(AgentFrameworkService.WebAppUploadFilenamePrefix, StringComparison.Ordinal));
    }
}

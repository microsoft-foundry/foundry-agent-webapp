namespace WebApp.Api.Models;

/// <summary>
/// Summary of files previously uploaded by this web app for image attachments.
/// Only files whose name begins with the web-app upload prefix are counted.
/// </summary>
public record UploadedFilesInfo(int Count, long TotalBytes);

/// <summary>
/// Result of a cleanup operation that deletes all web-app uploaded files.
/// </summary>
public record UploadedFilesCleanupResult(int Deleted, int Failed);

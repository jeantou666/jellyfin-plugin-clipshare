using System;
using System.Text.Json.Serialization;

namespace ClipShare.Helper;

/// <summary>
/// Payload for file transformation.
/// </summary>
public class PayloadRequest
{
    [JsonPropertyName("contents")]
    public string? Contents { get; set; }
}

/// <summary>
/// Injects ClipShare script into Jellyfin web pages.
/// </summary>
public static class Injector
{
    private const string ScriptTag = "<script src=\"/ClipShare/Script/clipshare.js\" defer></script>";

    /// <summary>
    /// Injects the ClipShare script into the HTML content.
    /// Called by the FileTransformation plugin.
    /// </summary>
    public static string InjectScript(PayloadRequest payload)
    {
        var contents = payload.Contents ?? string.Empty;

        if (string.IsNullOrEmpty(contents) || contents.Contains("/ClipShare/Script/clipshare.js"))
        {
            return contents;
        }

        // Find </head> and inject before it
        var headCloseIndex = contents.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);

        if (headCloseIndex > 0)
        {
            return contents.Insert(headCloseIndex, ScriptTag);
        }

        // Fallback: find <body>
        var bodyIndex = contents.IndexOf("<body", StringComparison.OrdinalIgnoreCase);

        if (bodyIndex > 0)
        {
            return contents.Insert(bodyIndex, ScriptTag);
        }

        return contents + ScriptTag;
    }
}

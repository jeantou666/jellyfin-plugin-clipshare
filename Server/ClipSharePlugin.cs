using System;
using System.Collections.Generic;
using System.IO;
using ClipShare.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace ClipShare;

/// <summary>
/// ClipShare Plugin - Allows creating video clips from the Jellyfin player.
/// </summary>
public class ClipSharePlugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public static ClipSharePlugin? Instance { get; private set; }

    public override string Name => "ClipShare";

    public override string Description => "Create video clips directly from the Jellyfin video player.";

    public override Guid Id => Guid.Parse("7f4a3b2c-6d5e-4a11-9c2b-5e3a7d4f8a21");

    public ClipSharePlugin(
        IServerApplicationPaths applicationPaths,
        IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        
        // Log to file for debugging
        try
        {
            var logPath = Path.Combine(applicationPaths.LogDirectoryPath, "clipshare-plugin.log");
            Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
            File.WriteAllText(logPath, $"[{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}] ClipShare Plugin Constructor Called!\n");
        } catch { }
    }

    public IEnumerable<PluginPageInfo> GetPages() => new[]
    {
        new PluginPageInfo
        {
            Name = "clipshare",
            EmbeddedResourcePath = $"{GetType().Namespace}.Web.index.html"
        }
    };
}

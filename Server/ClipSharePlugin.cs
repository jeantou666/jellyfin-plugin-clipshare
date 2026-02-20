using System;
using ClipShare.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace ClipShare;

/// <summary>
/// ClipShare Plugin - Allows creating video clips from the Jellyfin player.
/// </summary>
public class ClipSharePlugin : BasePlugin<PluginConfiguration>
{
    public static ClipSharePlugin? Instance { get; private set; }

    public override string Name => "ClipShare";

    public override string Description => "Create video clips directly from the Jellyfin video player.";

    public override Guid Id => Guid.Parse("7f4a3b2c-6d5e-4a11-9c2b-5e3a7d4f8a21");

    public ClipSharePlugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }
}

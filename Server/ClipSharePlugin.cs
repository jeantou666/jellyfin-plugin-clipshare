using System;
using System.Collections.Generic;
using ClipShare.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace ClipShare;

public class ClipSharePlugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public static ClipSharePlugin? Instance { get; private set; }

    public override string Name => "ClipShare";

    public override Guid Id => Guid.Parse("7f4a3b2c-6d5e-4a11-9c2b-5e3a7d4f8a21");

    public ClipSharePlugin(
        IServerApplicationPaths applicationPaths,
        IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
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

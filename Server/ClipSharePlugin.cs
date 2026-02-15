using System;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Model.Plugins;
using Microsoft.Extensions.Logging;
using System.Collections.Generic;
using System.Linq;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Plugins;



namespace ClipShare
{
    public class ClipSharePlugin : BasePlugin<PluginConfiguration>, IHasWebPages
    {
        public override string Name => "ClipShare";
        public override Guid Id => Guid.Parse("7f4a3b2c-6d5e-4a11-9c2b-5e3a7d4f8a21");

        public ClipSharePlugin(IServerApplicationPaths applicationPaths, ILogger<ClipSharePlugin> logger)
            : base(applicationPaths, logger)
        {
            Instance = this;
        }

        public static ClipSharePlugin? Instance { get; private set; }

        public override string Description =>
            "Create temporary public shareable clips from videos.";

        public IEnumerable<PluginPageInfo> GetPages() => new[]
        {
            new PluginPageInfo
            {
                Name = "clipshare",
                EmbeddedResourcePath = GetType().Namespace + ".Web.index.html"
            }
        };

    }

    public class PluginConfiguration : BasePluginConfiguration
    {
        public int DefaultExpirationHours { get; set; } = 72;
        public string ClipFolder { get; set; } = "clipshare";
    }
}

using System;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Model.Plugins;
using Microsoft.Extensions.Logging;

namespace ClipShare
{
    public class ClipSharePlugin : BasePlugin<PluginConfiguration>, IHasWebPages
    {
        public override string Name => "ClipShare";
        public override Guid Id => Guid.Parse("d9c4e7f4-6a5c-4c6b-9c1f-clipshare0001");

        public ClipSharePlugin(IApplicationPaths applicationPaths, ILogger<ClipSharePlugin> logger)
            : base(applicationPaths, logger)
        {
            Instance = this;
        }

        public static ClipSharePlugin? Instance { get; private set; }

        public override string Description =>
            "Create temporary public shareable clips from videos.";

        public IEnumerable<PluginPageInfo> GetPages()
        {
            return Array.Empty<PluginPageInfo>();
        }
    }

    public class PluginConfiguration : BasePluginConfiguration
    {
        public int DefaultExpirationHours { get; set; } = 72;
        public string ClipFolder { get; set; } = "clipshare";
    }
}

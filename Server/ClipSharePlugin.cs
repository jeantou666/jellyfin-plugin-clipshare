using System;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Model.Plugins;
using Microsoft.Extensions.Logging;
using System.Collections.Generic;
using System.Linq;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;


namespace ClipShare
{
    public ClipSharePlugin(
    IServerApplicationPaths applicationPaths,
    IXmlSerializer xmlSerializer)
    : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }


    public class PluginConfiguration : BasePluginConfiguration
    {
        public int DefaultExpirationHours { get; set; } = 72;
        public string ClipFolder { get; set; } = "clipshare";
    }
}

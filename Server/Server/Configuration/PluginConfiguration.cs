using MediaBrowser.Model.Plugins;

namespace ClipShare.Configuration;

public class PluginConfiguration : BasePluginConfiguration
{
    public int DefaultExpirationHours { get; set; } = 72;
}

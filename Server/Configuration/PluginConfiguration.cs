using MediaBrowser.Model.Plugins;

namespace ClipShare.Configuration;

public class PluginConfiguration : BasePluginConfiguration
{
    public int DefaultExpirationHours { get; set; } = 72;

    /// <summary>
    /// Whether to use the FileTransformation plugin for automatic script injection.
    /// </summary>
    public bool AutoInjectScript { get; set; } = true;

    /// <summary>
    /// Whether the FileTransformation plugin was detected.
    /// </summary>
    public bool FileTransformationAvailable { get; set; }
}

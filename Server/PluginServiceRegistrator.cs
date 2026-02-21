using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace ClipShare;

/// <summary>
/// Registers the ClipShare plugin services with Jellyfin's dependency injection container.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        // The plugin will be instantiated by Jellyfin's plugin loader
        // This registrator is just to ensure the plugin services are registered
    }
}

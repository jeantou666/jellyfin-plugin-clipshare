using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.DependencyInjection;

namespace ClipShare;

/// <summary>
/// Registers the ClipShare plugin services with Jellyfin's dependency injection container.
/// This class is required for Jellyfin to properly discover and load the plugin.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationPaths applicationPaths)
    {
        // Register the plugin as a singleton
        serviceCollection.AddSingleton<ClipSharePlugin>(sp =>
        {
            var xmlSerializer = sp.GetRequiredService<IXmlSerializer>();
            return new ClipSharePlugin(applicationPaths, xmlSerializer);
        });
    }
}

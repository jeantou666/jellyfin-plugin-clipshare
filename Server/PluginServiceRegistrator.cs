using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace ClipShare;

/// <summary>
/// Registers the ClipShare plugin services with Jellyfin's dependency injection container.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationPaths applicationPaths)
    {
        // Register the startup filter for script injection
        serviceCollection.AddTransient<IStartupFilter, ScriptInjectionStartupFilter>();

        // Register the plugin as a singleton
        serviceCollection.AddSingleton<ClipSharePlugin>(sp =>
        {
            var xmlSerializer = sp.GetRequiredService<IXmlSerializer>();
            return new ClipSharePlugin(applicationPaths, xmlSerializer);
        });
    }
}

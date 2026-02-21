using System;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace ClipShare;

/// <summary>
/// Registers plugin services with Jellyfin's DI container.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        // Register the startup filter for script injection (this runs very early)
        serviceCollection.AddTransient<IStartupFilter, ScriptInjectionStartupFilter>();
        
        // Register the plugin instance
        serviceCollection.AddSingleton<ClipSharePlugin>(sp =>
        {
            var applicationPaths = sp.GetRequiredService<IApplicationPaths>();
            var xmlSerializer = sp.GetRequiredService<IXmlSerializer>();
            return new ClipSharePlugin((IServerApplicationPaths)applicationPaths, xmlSerializer);
        });
        
        // Register the entry point
        serviceCollection.AddSingleton<IServerEntryPoint, ClipShareEntryPoint>();
    }
}

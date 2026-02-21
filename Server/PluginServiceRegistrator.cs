using ClipShare.Middleware;
using ClipShare.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace ClipShare;

/// <summary>
/// Register ClipShare services and middleware.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddHostedService<Entrypoint>();
        serviceCollection.AddTransient<IStartupFilter, ScriptInjectionStartupFilter>();
    }
}

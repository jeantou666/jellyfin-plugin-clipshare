using System;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Threading;
using System.Threading.Tasks;
using ClipShare.Helper;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace ClipShare.Services;

/// <summary>
/// Hosted service that initializes the web script injector.
/// </summary>
public class Entrypoint : IHostedService
{
    private readonly ILogger<Entrypoint> _logger;

    public Entrypoint(ILogger<Entrypoint> logger)
    {
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("[ClipShare] Entrypoint starting...");

        var plugin = ClipSharePlugin.Instance;
        if (plugin?.Configuration.AutoInjectScript == true)
        {
            InitializeWebInjector();
        }
        else
        {
            _logger.LogInformation("[ClipShare] Auto-injection disabled in configuration");
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }

    private void InitializeWebInjector()
    {
        try
        {
            var payload = new JObject
            {
                { "id", "7f4a3b2c-6d5e-4a11-9c2b-5e3a7d4f8a21" },
                { "fileNamePattern", "index.html" },
                { "callbackAssembly", GetType().Assembly.FullName },
                { "callbackClass", typeof(Injector).FullName },
                { "callbackMethod", nameof(Injector.InjectScript) }
            };

            var fileTransformationAssembly = AssemblyLoadContext.All
                .SelectMany(x => x.Assemblies)
                .FirstOrDefault(x => x.FullName?.Contains(".FileTransformation", StringComparison.Ordinal) ?? false);

            if (fileTransformationAssembly is not null)
            {
                _logger.LogInformation("[ClipShare] FileTransformation plugin found, registering injector");
                var pluginInterfaceType = fileTransformationAssembly.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface");
                pluginInterfaceType?.GetMethod("RegisterTransformation")?.Invoke(null, [payload]);
                _logger.LogInformation("[ClipShare] Script injector registered successfully");
            }
            else
            {
                _logger.LogWarning("[ClipShare] FileTransformation plugin not found!");
                _logger.LogWarning("[ClipShare] Install it from: https://github.com/nicknsy/jellyfin-plugin-file-transformation");
                _logger.LogWarning("[ClipShare] Or use the JavaScript Injector plugin: https://github.com/n00bcodr/Jellyfin-JavaScript-Injector");
                _logger.LogWarning("[ClipShare] With JavaScript Injector, use this URL: /ClipShare/Script/clipshare.js");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[ClipShare] Failed to initialize web injector");
        }
    }
}

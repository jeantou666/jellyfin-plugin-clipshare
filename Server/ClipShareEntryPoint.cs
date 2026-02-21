using System;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.Logging;

namespace ClipShare;

/// <summary>
/// Server entry point that injects the ClipShare script into Jellyfin pages.
/// </summary>
public class ClipShareEntryPoint : IServerEntryPoint
{
    private readonly IServerApplicationHost _appHost;
    private readonly ILogger<ClipShareEntryPoint> _logger;
    
    public ClipShareEntryPoint(IServerApplicationHost appHost, ILogger<ClipShareEntryPoint> logger)
    {
        _appHost = appHost;
        _logger = logger;
    }

    public Task RunAsync()
    {
        _logger.LogInformation("[ClipShare] EntryPoint started - Plugin is loading!");
        
        // Set the plugin instance if not already set
        if (ClipSharePlugin.Instance == null)
        {
            _logger.LogWarning("[ClipShare] Plugin instance was null in EntryPoint");
        }
        else
        {
            _logger.LogInformation("[ClipShare] Plugin instance is available");
        }
        
        return Task.CompletedTask;
    }

    public void Dispose()
    {
    }
}

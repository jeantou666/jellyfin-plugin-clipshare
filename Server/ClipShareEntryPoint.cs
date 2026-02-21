using System;
using System.Threading.Tasks;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.Logging;

namespace ClipShare;

/// <summary>
/// Server entry point that confirms the plugin is loaded.
/// </summary>
public class ClipShareEntryPoint : IServerEntryPoint
{
    private readonly ILogger<ClipShareEntryPoint> _logger;
    
    public ClipShareEntryPoint(ILogger<ClipShareEntryPoint> logger)
    {
        _logger = logger;
    }

    public Task RunAsync()
    {
        _logger.LogInformation("[ClipShare] ========== ENTRYPOINT STARTED ==========");
        _logger.LogInformation("[ClipShare] EntryPoint is running - plugin services are registered!");
        
        // Check if the plugin instance is available
        if (ClipSharePlugin.Instance != null)
        {
            _logger.LogInformation("[ClipShare] Plugin Instance: FOUND");
            _logger.LogInformation("[ClipShare] Plugin Name: {Name}", ClipSharePlugin.Instance.Name);
            _logger.LogInformation("[ClipShare] Plugin ID: {Id}", ClipSharePlugin.Instance.Id);
        }
        else
        {
            _logger.LogWarning("[ClipShare] Plugin Instance: NULL - Plugin class was not instantiated by Jellyfin");
            _logger.LogWarning("[ClipShare] This means Jellyfin's plugin loader did not call the ClipSharePlugin constructor");
        }
        
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        _logger.LogInformation("[ClipShare] EntryPoint disposed");
    }
}

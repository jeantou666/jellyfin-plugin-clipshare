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
        _logger.LogInformation("[ClipShare] EntryPoint started - Plugin is loading!");
        
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

using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ClipShare.Services;

/// <summary>
/// Hosted service for ClipShare initialization.
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
        _logger.LogInformation("[ClipShare] Plugin loaded successfully");
        _logger.LogInformation("[ClipShare] Script injection middleware registered");
        _logger.LogInformation("[ClipShare] Script available at: /ClipShare/Script/clipshare.js");
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }
}

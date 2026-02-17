using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ClipShare.Controllers;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ClipShare.Services
{
    public class ClipCleaner : BackgroundService
    {
        private readonly ILogger<ClipCleaner> _logger;

        public ClipCleaner(ILogger<ClipCleaner> logger)
        {
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("ClipShare cleaner started");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var now = DateTime.UtcNow;

                    var expired = ClipShareController
                        .GetAllClips()
                        .Where(c => c.ExpirationDate < now)
                        .ToList();

                    foreach (var clip in expired)
                    {
                        try
                        {
                            if (File.Exists(clip.FilePath))
                                File.Delete(clip.FilePath);

                            ClipShareController.RemoveClip(clip.Id);
                            _logger.LogInformation($"Deleted expired clip {clip.Id}");
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, $"Failed deleting {clip.Id}");
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Cleaner error");
                }

                await Task.Delay(TimeSpan.FromMinutes(10), stoppingToken);
            }
        }
    }
}

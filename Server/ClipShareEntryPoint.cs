using System;
using System.Threading.Tasks;
using MediaBrowser.Controller.Plugins;

namespace ClipShare;

/// <summary>
/// Entry point that runs when Jellyfin server starts.
/// </summary>
public class ClipShareEntryPoint : IServerEntryPoint
{
    public Task RunAsync()
    {
        // Log that the plugin entry point has started
        System.IO.File.AppendAllText("/tmp/clipshare-entrypoint.log",
            $"[{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}] ClipShare EntryPoint Started!\n");
        return Task.CompletedTask;
    }

    public void Dispose()
    {
    }
}
